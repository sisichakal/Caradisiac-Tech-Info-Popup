// ==UserScript==
// @name         Caradisiac Tech Info Popup
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Affiche un pop-in avec les informations techniques colorées sur Caradisiac
// @author       You
// @match        https://www.caradisiac.com/fiches-techniques/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=caradisiac.com
// @updateURL    https://raw.githubusercontent.com/sisichakal/Caradisiac-Tech-Info-Popup/main/Caradisiac-Tech-Info-Popup.user.js
// @downloadURL  https://raw.githubusercontent.com/sisichakal/Caradisiac-Tech-Info-Popup/main/Caradisiac-Tech-Info-Popup.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Only run on detailed spec pages:
    // /fiches-techniques/modele--xxx/yyyy/version/
    // i.e. at least 3 path segments after /fiches-techniques/
    const pathParts = window.location.pathname
        .replace(/^\/fiches-techniques\//, '')
        .split('/')
        .filter(Boolean);

    if (pathParts.length < 3) {
        return;
    }

    // -------------------------------------------------------------------------
    // Colour criteria (same thresholds as the Argus popup)
    // -------------------------------------------------------------------------
    const criteria = {
        longueur:    [4.20, 4.40, 4.50],
        reservoir:   [60, 50, 40],
        poids:       [1250, 1400, 1500],
        coffre:      [450, 400, 350],
        coffreUtile: [1300, 1100, 950],
        roues:       [18, 16, 15],
        vitesseMax:  [200, 190, 180],
        acceleration:[8, 9, 10],
        urbain:      [6, 7, 8],
        puissance:   [150, 120, 90],
    };

    // Prevent the popup from reappearing once dismissed
    let dismissed = false;

    // -------------------------------------------------------------------------
    // Colour helpers
    // -------------------------------------------------------------------------
    function parseNumericValue(value) {
        if (!value || value === 'N/A') return null;
        // Remove spaces used as thousands separators, then parse
        const cleaned    = value.toString().replace(/\s/g, '').replace(/[^\d,.-]/g, '');
        const normalized = cleaned.replace(',', '.');
        const num        = parseFloat(normalized);
        return isNaN(num) ? null : num;
    }

    function getColor(value, criteriaArray, isReverse = false) {
        const numValue = parseNumericValue(value);
        if (numValue === null) return { color: '#999999', background: '#99999920' };
        const [first, second, third] = criteriaArray;
        if (isReverse) {
            if (numValue <= first)  return { color: '#4CAF50', background: '#4CAF5020' };
            if (numValue <= second) return { color: '#FF9800', background: '#FF980020' };
            if (numValue <= third)  return { color: '#f44336', background: '#f4433620' };
            return { color: '#ffffff', background: '#000000' };
        } else {
            if (numValue >= first)  return { color: '#4CAF50', background: '#4CAF5020' };
            if (numValue >= second) return { color: '#FF9800', background: '#FF980020' };
            if (numValue >= third)  return { color: '#f44336', background: '#f4433620' };
            return { color: '#ffffff', background: '#000000' };
        }
    }

    function getArchitectureColor(value) {
        if (!value || value === 'N/A') return { color: '#999999', background: '#99999920' };
        const cylinderMatch = value.toString().toLowerCase().match(/(\w+)\s+cylindre/);
        if (!cylinderMatch) return { color: '#999999', background: '#99999920' };
        const numberWords = {
            'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4,
            'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
        };
        const cylinderCount = numberWords[cylinderMatch[1]] || 0;
        return cylinderCount < 4
            ? { color: '#ffffff', background: '#000000' }
            : { color: '#4CAF50', background: '#4CAF5020' };
    }

    // -------------------------------------------------------------------------
    // Data extraction
    // Caradisiac uses plain <table> elements with <tr><td>Label</td><td>Value</td></tr>
    // -------------------------------------------------------------------------

    // Returns the raw text of the value cell matching a label, or 'N/A'
    function findRawValue(searchTerms) {
        for (const term of searchTerms) {
            for (const row of document.querySelectorAll('table tr')) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) continue;
                const labelText = (cells[0].textContent || '').trim();
                if (labelText.toLowerCase().includes(term.toLowerCase())) {
                    return (cells[1].textContent || '').trim();
                }
            }
        }
        return 'N/A';
    }

    // Extract a numeric value from the matched cell
    function extractValue(searchTerms, isWeight = false, isVolume = false, isWheel = false) {
        const raw = findRawValue(searchTerms);
        if (raw === 'N/A') return 'N/A';

        if (isWheel) {
            const wheelMatch = raw.match(/R(\d+)/i);
            return wheelMatch ? wheelMatch[1] : 'N/A';
        }

        if (isWeight || isVolume) {
            // Remove spaces used as thousands separators (e.g. "1 555 kg")
            const clean = raw.replace(/(\d)\s+(\d)/g, '$1$2');
            const match = clean.match(/[\d,]+\.?\d*/);
            return match ? match[0].replace(',', '.') : 'N/A';
        }

        const match = raw.replace(/(\d)\s+(\d)/g, '$1$2').match(/[\d,]+\.?\d*/);
        return match ? match[0].replace(',', '.') : 'N/A';
    }

    // Extract a full text value (architecture, spare wheel type…)
    function extractText(searchTerms) {
        return findRawValue(searchTerms);
    }

    // Caradisiac stores coffre as "341 l / 1 157 l" in a single cell
    // Extract min (normal) and max (utile) from that combined field
    function extractCoffreValues() {
        const raw = findRawValue(['volume de coffre']);
        if (raw === 'N/A') return { coffre: 'N/A', coffreUtile: 'N/A' };

        // Remove thousands-separator spaces, then match all numbers
        const clean   = raw.replace(/(\d)\s+(\d)/g, '$1$2');
        const matches = clean.match(/\d+/g);
        if (!matches || matches.length === 0) return { coffre: 'N/A', coffreUtile: 'N/A' };

        return {
            coffre:      matches[0],
            coffreUtile: matches.length > 1 ? matches[1] : 'N/A',
        };
    }

    // -------------------------------------------------------------------------
    // Range calculation
    // -------------------------------------------------------------------------
    function calcRange(conso, reservoir) {
        const consoNum     = parseNumericValue(conso);
        const reservoirNum = parseNumericValue(reservoir);
        if (!consoNum || !reservoirNum || consoNum === 0) return null;
        return Math.round((reservoirNum / consoNum) * 100);
    }

    function buildConsoLine(conso, reservoir) {
        const consoDisplay = conso !== 'N/A' ? conso + 'L' : 'N/A';
        const range        = calcRange(conso, reservoir);
        const rangeDisplay = range !== null ? range + ' km' : 'N/A';
        return consoDisplay + ' - ' + rangeDisplay;
    }

    // -------------------------------------------------------------------------
    // Popup
    // -------------------------------------------------------------------------
    function createPopup() {
        if (dismissed || document.getElementById('caradisiac-popup')) return;

        const coffreValues = extractCoffreValues();

        const data = {
            longueur:     extractValue(['longueur']),
            largeur:      extractValue(['largeur sans rétros', 'largeur']),
            poids:        extractValue(['poids à vide'], true),
            coffre:       coffreValues.coffre,
            coffreUtile:  coffreValues.coffreUtile,
            roues:        extractValue(['pneumatiques avant', 'pneus avant', 'taille des roues avant'], false, false, true),
            puissance:    extractValue(['puissance din', 'puissance maxi', 'puissance ch']),
            vitesseMax:   extractValue(['vitesse maxi', 'vitesse maximale']),
            acceleration: extractValue(['0 à 100', '0-100']),
            urbain:       extractValue(['urbain', 'consommation urbaine', 'cycle urbain']),
            mixte:        extractValue(['mixte', 'consommation mixte']),
            extraUrbain:  extractValue(['extra-urbain', 'extra urbain', 'consommation extra']),
            reservoir:    extractValue(['réservoir', 'capacité réservoir']),
            architecture: extractText(['architecture', 'type de moteur']),
            roueSecours:  extractText(['roue de secours', 'roues de secours']),
        };

        console.log('[CaradisiacPopup] Valeurs extraites:', data);

        // Skip popup if no data at all
        const hasAnyValue = Object.values(data).some(v => v !== 'N/A');
        if (!hasAnyValue) {
            console.log('[CaradisiacPopup] Aucune donnée trouvée, popup ignoré.');
            return;
        }

        // --- Combined display values ---

        const longueurLargeurDisplay = [
            data.longueur !== 'N/A' ? data.longueur + 'm' : 'N/A',
            data.largeur  !== 'N/A' ? data.largeur  + 'm' : 'N/A',
        ].join(' - ');
        const longueurLargeurColor = getColor(data.longueur, criteria.longueur, true);

        const coffreDisplay = [
            data.coffre      !== 'N/A' ? data.coffre      + 'L' : 'N/A',
            data.coffreUtile !== 'N/A' ? data.coffreUtile + 'L' : 'N/A',
        ].join(' - ');
        const coffreColor = getColor(data.coffre, criteria.coffre, false);

        // Spare wheel icon
        const roueSecoursNormale = data.roueSecours !== 'N/A' &&
            data.roueSecours.toLowerCase().includes('normale');
        const roueSecoursIcon = data.roueSecours === 'N/A'
            ? ''
            : (roueSecoursNormale
                ? ' <span style="filter:hue-rotate(90deg) saturate(3) brightness(0.8);">🛞</span>'
                : ' 🚫');
        const rouesDisplay = (data.roues !== 'N/A' ? data.roues + '"' : 'N/A') + roueSecoursIcon;

        // Conso lines
        const consoUrbainLine = buildConsoLine(data.urbain,      data.reservoir);
        const consoMixteLine  = buildConsoLine(data.mixte,       data.reservoir);
        const consoExtraLine  = buildConsoLine(data.extraUrbain, data.reservoir);

        // --- Build popup DOM ---

        const popup = document.createElement('div');
        popup.id = 'caradisiac-popup';
        popup.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 380px;
            background: white;
            border: 2px solid #333;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            background: #c00;
            color: white;
            padding: 10px;
            border-radius: 8px 8px 0 0;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <span>Informations Techniques v1.2</span>
            <span id="caradisiac-close-popup" style="cursor:pointer;font-size:18px;">&times;</span>
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            padding: 15px;
            max-height: 600px;
            overflow-y: auto;
        `;

        const infos = [
            {
                label:     'Longueur / Largeur',
                display:   longueurLargeurDisplay,
                colorInfo: longueurLargeurColor,
            },
            {
                label:     'Poids à vide',
                display:   data.poids !== 'N/A' ? data.poids + ' kg' : 'N/A',
                colorInfo: getColor(data.poids, criteria.poids, true),
            },
            {
                label:     'Volume de coffre + volume utile',
                display:   coffreDisplay,
                colorInfo: coffreColor,
            },
            {
                label:     'Taille des roues avant',
                display:   rouesDisplay,
                colorInfo: getColor(data.roues, criteria.roues, false),
            },
            {
                label:     'Puissance DIN',
                display:   data.puissance !== 'N/A' ? data.puissance + ' ch' : 'N/A',
                colorInfo: getColor(data.puissance, criteria.puissance, false),
            },
            {
                label:     'Vitesse maximale',
                display:   data.vitesseMax !== 'N/A' ? data.vitesseMax + ' km/h' : 'N/A',
                colorInfo: getColor(data.vitesseMax, criteria.vitesseMax, false),
            },
            {
                label:     '0 à 100 km/h',
                display:   data.acceleration !== 'N/A' ? data.acceleration + ' s' : 'N/A',
                colorInfo: getColor(data.acceleration, criteria.acceleration, true),
            },
            {
                label:     'Conso Urbain',
                display:   consoUrbainLine,
                colorInfo: getColor(data.urbain, criteria.urbain, true),
            },
            {
                label:     'Conso Mixte',
                display:   consoMixteLine,
                colorInfo: getColor(data.mixte, criteria.urbain, true),
            },
            {
                label:     'Conso Extra',
                display:   consoExtraLine,
                colorInfo: getColor(data.extraUrbain, criteria.urbain, true),
            },
            {
                label:     'Réservoir',
                display:   data.reservoir !== 'N/A' ? data.reservoir + ' L' : 'N/A',
                colorInfo: getColor(data.reservoir, criteria.reservoir, false),
            },
            {
                label:     'Architecture',
                display:   data.architecture,
                colorInfo: getArchitectureColor(data.architecture),
            },
        ];

        infos.forEach(info => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid #eee;
            `;
            row.innerHTML = `
                <span style="font-weight:500;">${info.label}</span>
                <span style="
                    color:${info.colorInfo.color};
                    font-weight:bold;
                    padding:4px 8px;
                    border-radius:4px;
                    background:${info.colorInfo.background};
                ">${info.display}</span>
            `;
            content.appendChild(row);
        });

        popup.appendChild(header);
        popup.appendChild(content);
        document.body.appendChild(popup);

        // Close button
        document.getElementById('caradisiac-close-popup').addEventListener('click', (e) => {
            e.stopPropagation();
            dismissed = true;
            popup.remove();
        });

        // Click outside to close
        document.addEventListener('click', function onOutsideClick(e) {
            if (!popup.contains(e.target)) {
                dismissed = true;
                popup.remove();
                document.removeEventListener('click', onOutsideClick);
            }
        });

        console.log('[CaradisiacPopup] Pop-in créé avec succès.');
    }

    // -------------------------------------------------------------------------
    // Bootstrap
    // -------------------------------------------------------------------------
    function waitForPageLoad() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(createPopup, 1500));
        } else {
            setTimeout(createPopup, 1500);
        }
    }

    // MutationObserver for dynamic rendering — respects dismissed flag
    const observer = new MutationObserver(() => {
        if (!dismissed) {
            setTimeout(createPopup, 2000);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    waitForPageLoad();

})();
