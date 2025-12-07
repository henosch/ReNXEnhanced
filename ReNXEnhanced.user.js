// ==UserScript==
// @name         ReNXEnhanced
// @namespace    https://github.com/henosch/ReNXEnhanced
// @version      2.9.2
// @description  A lightweight Tampermonkey script for importing and exporting NextDNS configuration profiles, with advanced filtering and management features.
// @author       henosch (based on OrigamiOfficial & hjk789/NXEnhanced)
// @match        https://my.nextdns.io/*
// @grant        none
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/henosch/ReNXEnhanced/main/ReNXEnhanced.user.js
// @downloadURL  https://raw.githubusercontent.com/henosch/ReNXEnhanced/main/ReNXEnhanced.user.js
// ==/UserScript==

// --- DEBUG MODE TOGGLE ---
// Set to 1 for ON, 0 for OFF.
const DEBUG_MODE_OVERRIDE = 1; 
// --- END DEBUG MODE TOGGLE ---


(function() {
    'use strict';

    // Add styles for better UX
    const style = document.createElement("style");
    style.innerHTML = `
        /* List Groups */
        .list-group-item:hover .btn { visibility: visible !important; } 
        
        /* Logs Page Specifics */
        .nxe-log-row { position: relative !important; } 
        
        .nxe-log-row:hover .nxe-btn-group { 
            visibility: visible !important; 
            opacity: 1 !important; 
            display: flex !important;
        }
        
        .nxe-btn-group { 
            transition: opacity 0.1s; 
            opacity: 0; 
            visibility: hidden; 
            z-index: 99999; 
            position: absolute; 
            right: 60px; 
            top: 50%; 
            transform: translateY(-50%);
            pointer-events: auto; 
            white-space: nowrap;
            background: rgba(255,255,255,0.9); 
            border-radius: 4px;
            padding: 2px;
        }

        /* Tooltips */
        .tooltipParent:hover .customTooltip { opacity: 1 !important; visibility: visible !important; }
        .tooltipParent .customTooltip:hover { opacity: 0 !important; visibility: hidden !important; }
        
        /* General */
        div:hover #counters { visibility: hidden !important; }
        .list-group-item:hover input.description, input.description:focus { display: initial !important;}
        .Logs .row > * { width: auto; }
        .nxe-toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; padding: 10px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; }
        .nxe-select-checkbox { margin-right: 10px; transform: scale(1.2); cursor: pointer; }
        .nxe-warning { width: 100%; color: #856404; background-color: #fff3cd; border-color: #ffeeba; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
        
        /* Style for TLD buttons */
        #addAllTLDsBtn, #removeAllTLDsBtn {
            display: inline-block !important; 
            z-index: 9999;
        }
    `;
    document.head.appendChild(style);

    const generateId = (prefix) => `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
    const LOG_ROW_SELECTORS = [".row", ".list-group-item", ".log"];
    const DOMAIN_SELECTOR_PRIORITY = [
        '[data-testid="log-domain"]',
        '[data-testid="domain-name"]',
        '[data-test="domain-name"]',
        '.domainName',
        '.domain-name',
        '.domain',
        '.text-truncate',
        '.col a',
        'a[href*="/logs/"]',
        'a[href^="/"]'
    ];

    function log(msg, ...args) {
        if (ReNXsettings && ReNXsettings.debugMode) {
            console.log(`[ReNX] ${msg}`, ...args);
        }
    }

    function safeAppend(parent, child) {
        try {
            if (parent && child) {
                parent.appendChild(child);
            }
        } catch (e) {
            console.error("[ReNX] safeAppend Error:", e);
        }
    }

    function makeApiRequest(method, path, body, retryCount = 0) {
        return new Promise(function(resolve, reject) {
            const xhr = new XMLHttpRequest();
            const profileId = location.href.split("/")[3];
            
            xhr.open(method, "https://api.nextdns.io/profiles/" + profileId + "/" + path, true);
            xhr.withCredentials = true;
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            xhr.setRequestHeader("Pragma", "no-cache");
            xhr.setRequestHeader("Expires", "0");

            xhr.onreadystatechange = async function() {
                if (xhr.readyState == 4) {
                    if (xhr.status === 426) { 
                        log(`Received 426 Upgrade Required for ${method} ${path}`);
                        reject("Upgrade Required (426)");
                        return;
                    }

                    if (xhr.status === 429) {
                        if (retryCount >= 7) {
                            reject(`Rate Limit 429 exceeded max retries (${retryCount})`);
                            return;
                        }
                        const waitTime = (Math.pow(2, retryCount) * 2500) + (Math.random() * 1000); 
                        console.warn(`[ReNX] Rate Limit 429. Waiting ${Math.round(waitTime)}ms before retry ${retryCount + 1}...`);
                        await sleep(waitTime);
                        makeApiRequest(method, path, body, retryCount + 1).then(resolve).catch(reject);
                        return;
                    }

                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(xhr.responseText);
                    } else {
                        console.error("ReNXEnhanced API Error:", method, path, xhr.status, xhr.responseText);
                        reject(xhr.responseText);
                    }
                }
            };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    function convertToHex(str) {
        let hex = '';
        for (let i = 0; i < str.length; i++) {
            hex += '' + str.charCodeAt(i).toString(16);
        }
        return hex;
    }

    const MULTI_PART_TLDS = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "sch.uk", "com.au", "net.au", "org.au", "gov.au", "com.br", "net.br", "gov.br", "co.jp"]);

    function getBlockedTldPaths(tld) {
        if (!tld) return [];
        const normalized = tld.trim().toLowerCase();
        if (!normalized) return [];
        const asciiSafe = /^[a-z0-9-]+$/.test(normalized);
        const paths = [];
        if (asciiSafe) paths.push(`security/blocked_tlds/${encodeURIComponent(normalized)}`);
        paths.push(`security/blocked_tlds/hex:${convertToHex(normalized)}`);
        return paths;
    }

    function normalizeDomainValue(domain) {
        if (!domain) return "";
        let normalized = domain.trim().toLowerCase();
        normalized = normalized.replace(/^(\*|\.)+/g, "");
        normalized = normalized.replace(/\.+$/g, "");
        return normalized;
    }

    function getRootDomain(domain) {
        const normalized = normalizeDomainValue(domain);
        if (!normalized.includes(".")) return normalized;
        const parts = normalized.split(".");
        if (parts.length < 2) return normalized;
        const suffixTwo = parts.slice(-2).join(".");
        if (MULTI_PART_TLDS.has(suffixTwo) && parts.length >= 3) {
            return parts.slice(-3).join(".");
        }
        return suffixTwo;
    }

    let tldApiAvailable = false;
    async function addBlockedTld(tld) {
        if (!tldApiAvailable) return false;
        const paths = getBlockedTldPaths(tld);
        let notFoundResponses = 0;
        for (const path of paths) {
            try {
                await makeApiRequest("PUT", path);
                return true;
            } catch (err) {
                const errText = typeof err === "string" ? err : (err ? JSON.stringify(err) : "");
                if (errText && errText.includes('"code":"notFound"')) {
                    notFoundResponses++;
                    continue;
                }
                throw err;
            }
        }
        if (notFoundResponses === paths.length) tldApiAvailable = false;
        return false;
    }

    async function clickAddTldButton(btn) {
        if (!btn) return false;
        return new Promise(resolve => {
            let success = btn.classList.contains("btn-danger");
            const finish = () => resolve(success);
            const observer = new MutationObserver(() => {
                success = btn.classList.contains("btn-danger");
                if (!btn.isConnected || success) {
                    observer.disconnect();
                    finish();
                }
            });
            observer.observe(btn, { attributes: true, attributeFilter: ["class"] });
            btn.click();
            setTimeout(() => {
                observer.disconnect();
                finish();
            }, 5000);
        });
    }

    function findLogsContainer() {
        const root = document.getElementById("root");
        if (root) {
            const exactMatch = root.querySelector(".Logs .list-group");
            if (exactMatch) return exactMatch;
            const partialMatch = Array.from(root.querySelectorAll("[class*='Logs']"))
                .map(section => section.querySelector(".list-group"))
                .find(Boolean);
            if (partialMatch) return partialMatch;
        }

        const direct = document.querySelector(".Logs .list-group");
        if (direct) return direct;

        const favicons = document.querySelectorAll('img[src*="favicons"]');
        if (favicons.length > 0) {
            let row = favicons[0].closest('.list-group-item') || favicons[0].closest('.row') || favicons[0].parentElement?.parentElement?.parentElement;
            if (row) return row.closest('.list-group') || row.parentElement;
        }
        return null;
    }

    function isRealLogRow(row) {
        if (!row) return false;
        if (row.querySelector('input[type="search"]') || row.querySelector('svg[data-icon="magnifying-glass"]')) return false;
        if (row.querySelector(".spinner-border") || row.querySelector(".spinner-grow")) return false;
        if (row.querySelector(".alert") || row.classList.contains("bg-2")) return false;
        if (row.classList.contains("nxe-log-row")) return true;
        if (row.textContent && row.textContent.trim().toLowerCase() === "no logs yet.") return false;
        const hasFavicon = row.querySelector('img[src*="favicons"]');
        const hasStats = row.querySelector("svg[data-icon='clock']");
        const hasDomainHint = DOMAIN_SELECTOR_PRIORITY.some(sel => row.querySelector(sel));
        return !!(hasFavicon || hasDomainHint || hasStats);
    }

    function processLogRowsFromNode(target, logsContainer) {
        if (!target || !logsContainer) return;
        const rows = new Set();
        if (target.classList) {
            LOG_ROW_SELECTORS.forEach(sel => {
                if (target.matches && target.matches(sel)) rows.add(target);
            });
        }
        if (target.querySelectorAll) {
            LOG_ROW_SELECTORS.forEach(sel => {
                target.querySelectorAll(sel).forEach(row => rows.add(row));
            });
        }
        rows.forEach(row => {
            if (logsContainer.contains(row) && isRealLogRow(row)) {
                enhanceLogRow(row);
            }
        });
    }

    function updateLogCountersDisplay(logsContainer) {
        if (!logsContainer) return;
        let blockedCounter = 0;
        let allowedCounter = 0;
        let hiddenCounter = 0;
        logsContainer.querySelectorAll('.nxe-log-row').forEach(row => {
            if (row.style.display === 'none') {
                hiddenCounter++;
                return;
            }
            const status = getLogRowStatus(row);
            if (status === "blocked") blockedCounter++;
            else if (status === "allowed") allowedCounter++;
        });
        const resetHiddenBtn = document.getElementById("resetHiddenBtn");
        if (resetHiddenBtn) {
            resetHiddenBtn.innerHTML = `Reset Hidden Domains (${hiddenCounter})`;
            resetHiddenBtn.disabled = hiddenCounter === 0;
        }
    }

    function attachHideOptionToMenu(menu, row) {
        if (!menu || !row) return false;
        if (menu.querySelector(".nxe-hide-option")) return true;
        const divider = document.createElement("div");
        divider.className = "dropdown-divider";
        safeAppend(menu, divider);
        const hideOption = document.createElement("button");
        hideOption.type = "button";
        hideOption.className = "dropdown-item nxe-hide-option";
        hideOption.innerText = "Hide entry";
        hideOption.onclick = function(e) { e.preventDefault(); e.stopPropagation(); hideLogEntry(row); };
        safeAppend(menu, hideOption);
        return true;
    }

    function initGlobalLogMenuObserver() {
        if (logMenuObserver) logMenuObserver.disconnect();
        logMenuObserver = new MutationObserver(mutations => {
            if (!isPage(REGEX_LOGS)) return;
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.classList && node.classList.contains("dropdown-menu")) {
                        const row = node.closest(".nxe-log-row");
                        if (row && attachHideOptionToMenu(node, row)) return;
                        const labelledBy = node.getAttribute("aria-labelledby");
                        if (labelledBy) {
                            const toggle = document.getElementById(labelledBy);
                            const toggleRow = toggle ? toggle.closest(".nxe-log-row") : null;
                            if (toggleRow) attachHideOptionToMenu(node, toggleRow);
                        }
                    }
                });
            });
        });
        logMenuObserver.observe(document.body, { childList: true, subtree: true });
    }

    function startLogMenuScan() {
        if (logMenuScanInterval) clearInterval(logMenuScanInterval);
        logMenuScanInterval = setInterval(() => {
            if (!isPage(REGEX_LOGS)) return;
            const logsContainer = findLogsContainer();
            if (!logsContainer) return;
            logsContainer.querySelectorAll(".dropdown-menu").forEach(menu => {
                const row = menu.closest(".nxe-log-row") || menu.closest(".list-group-item") || menu.closest(".row");
                if (row && !row.classList.contains("nxe-log-row")) {
                    enhanceLogRow(row);
                }
                const attachedRow = row && row.classList.contains("nxe-log-row") ? row : menu.closest(".nxe-log-row");
                if (attachedRow) attachHideOptionToMenu(menu, attachedRow);
            });
        }, 1200);
    }

    function getLogRowStatus(row) {
        if (!row) return "unknown";
        const statusAttr = row.getAttribute("data-status") || row.getAttribute("data-log-status");
        if (statusAttr) {
            const normalized = statusAttr.toLowerCase();
            if (normalized.includes("block")) return "blocked";
            if (normalized.includes("allow")) return "allowed";
        }
        const statusNodes = row.querySelectorAll('[data-testid*="status"], [data-test*="status"], .badge, .text-uppercase, .text-muted');
        for (const node of statusNodes) {
            const text = (node.textContent || node.innerText || "").trim().toLowerCase();
            if (!text) continue;
            if (text.includes("blocked") || text.includes("denied")) return "blocked";
            if (text.includes("allowed") || text.includes("permitted")) return "allowed";
        }
        if (row.querySelector(".text-danger, .badge-danger, .bg-danger, .border-danger, .text-error")) return "blocked";
        if (row.querySelector(".text-success, .badge-success, .bg-success, .border-success")) return "allowed";
        try {
            const borderColor = window.getComputedStyle(row).borderLeftColor;
            if (borderColor === 'rgb(255, 69, 0)' || borderColor === 'orangered' || borderColor === 'rgb(220, 53, 69)') return "blocked";
            if (borderColor === 'rgb(46, 204, 113)' || borderColor === 'rgb(40, 167, 69)') return "allowed";
        } catch(e) {}
        const inlineText = (row.innerText || "").toLowerCase();
        if (inlineText.includes("blocked")) return "blocked";
        if (inlineText.includes("allowed")) return "allowed";
        return "unknown";
    }

    function extractDomainFromText(text) {
        if (!text) return "";
        const cleaned = text.replace(/\s+/g, " ").trim();
        const match = cleaned.match(/([a-z0-9-]+\.)+[a-z0-9-]+/i);
        if (match) return match[0].toLowerCase();
        return "";
    }

    function getDomainFromRow(row) {
        if (!row) return "";
        if (row.querySelector('input[type="search"]') || row.querySelector('svg[data-icon="magnifying-glass"]')) return "";
        for (const selector of DOMAIN_SELECTOR_PRIORITY) {
            const node = row.querySelector(selector);
            if (node) {
                const domain = extractDomainFromText(node.textContent || node.innerText);
                if (domain) return domain;
            }
        }
        const dataDomain = row.getAttribute("data-domain");
        if (dataDomain) {
            const normalized = extractDomainFromText(dataDomain);
            if (normalized) return normalized;
        }
        const textLines = (row.innerText || "").split("\n").map(t => t.trim()).filter(Boolean);
        for (const line of textLines) {
            const domain = extractDomainFromText(line);
            if (domain) return domain;
        }
        return "";
    }

    function enhanceLogRow(row) {
        try {
            if (!row || row.classList.contains('nxe-log-row')) return; 

            const domainName = getDomainFromRow(row);
            if (!domainName) return;

            row.classList.add('nxe-log-row');
            row.style.position = 'relative'; 

            const actionMenu = row.querySelector(".dropdown-menu");
            if (actionMenu) attachHideOptionToMenu(actionMenu, row);
            else {
                const menuObserver = new MutationObserver(() => {
                    const menu = row.querySelector(".dropdown-menu");
                    if (menu && attachHideOptionToMenu(menu, row)) menuObserver.disconnect();
                });
                menuObserver.observe(row, { childList: true, subtree: true });
            }

            injectInlineLogButtons(row);

            if (ReNXsettings.hiddenDomains.includes(domainName)) {
                row.style.display = 'none';
            }

            if (ReNXsettings.logsDomainDescriptions[domainName]) {
                const tooltipParent = document.createElement("div");
                tooltipParent.className = "tooltipParent";
                tooltipParent.style = "display: contents;";
                tooltipParent.innerText = domainName; 
                const labelTarget = row.querySelector(".domainName") || row.querySelector('a[href^="/"]') || row;
                
                const tooltip = document.createElement("div");
                tooltip.className = "customTooltip text-muted small";
                tooltip.style.cssText = "position: absolute; z-index: 1000; top: 25px; background: #000; color: #fff; padding: 5px; border-radius: 5px; opacity: 0; visibility: hidden; transition: opacity .2s; pointer-events: none; white-space: nowrap;";
                tooltip.innerHTML = ReNXsettings.logsDomainDescriptions[domainName];
                
                safeAppend(tooltipParent, tooltip);
                if (labelTarget) {
                    labelTarget.innerHTML = ""; 
                    safeAppend(labelTarget, tooltipParent);
                }
            }
        } catch (e) {
            console.error("[ReNX] enhanceLogRow Error:", e);
        }
    }

    function injectInlineLogButtons(row) {
        if (row.querySelector(".nxe-btn-group")) return;
        const btnGroup = document.createElement("div");
        btnGroup.className = "nxe-btn-group btn-group btn-group-sm";
        btnGroup.style.cssText = "position: absolute; right: 180px; top: 50%; transform: translateY(-50%); opacity: 0; visibility: hidden; z-index: 9999; display: flex;";
        
        const allowBtn = document.createElement("button");
        allowBtn.className = "btn btn-success";
        allowBtn.innerHTML = "Allow";
        allowBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); allowDenyDomain(this, "allowlist"); };
        
        const denyBtn = document.createElement("button");
        denyBtn.className = "btn btn-danger";
        denyBtn.innerHTML = "Deny";
        denyBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); allowDenyDomain(this, "denylist"); };
        
        const hideBtn = document.createElement("button");
        hideBtn.className = "btn btn-dark";
        hideBtn.innerHTML = "Hide";
        hideBtn.title = "Hide this domain persistently";
        hideBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); hideLogEntry(row); };
        
        safeAppend(btnGroup, allowBtn);
        safeAppend(btnGroup, denyBtn);
        safeAppend(btnGroup, hideBtn);
        
        if (row.firstChild) row.insertBefore(btnGroup, row.firstChild);
        else safeAppend(row, btnGroup);
    }

    function shouldSkipListItem(item) {
        if (!item) return true;
        if (item.classList.contains("text-muted")) return true;
        const text = item.innerText || "";
        if (/Subdomains/i.test(text)) return true;
        if (item.querySelector("input[placeholder*='Add a domain']") || item.querySelector("textarea")) return true;
        return false;
    }

    function enhanceListItems(listGroup, listName) {
        if (!listGroup || !listName || isLargeListCache) return;
        const storeKey = listName + "Descriptions";
        if (!ReNXsettings[storeKey]) ReNXsettings[storeKey] = {};
        const descriptionsStore = ReNXsettings[storeKey];
        listGroup.querySelectorAll(".list-group-item").forEach(item => {
            if (shouldSkipListItem(item)) return;

            if (!item.querySelector(".nxe-select-checkbox")) {
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.className = "nxe-select-checkbox";
                checkbox.id = generateId("chk");
                safeAppend(item, checkbox);
            }

            let descriptionInput = item.querySelector(".description");
            if (!descriptionInput) {
                const domainSpan = item.querySelector("span");
                const domainText = domainSpan ? domainSpan.textContent.trim() : (item.textContent || "").trim();
                const domain = domainText.replace(/\s+/g, " ").trim();
                descriptionInput = document.createElement("input");
                descriptionInput.type = "text";
                descriptionInput.className = "description form-control form-control-sm";
                descriptionInput.placeholder = "Description";
                descriptionInput.style = "display: none; position: absolute; right: 40px; width: 200px;";
                descriptionInput.value = descriptionsStore[domain] || "";
                descriptionInput.dataset.nxeDomain = domain;
                safeAppend(item, descriptionInput);
            }

            if (!descriptionInput.dataset.nxeBound) {
                descriptionInput.dataset.nxeBound = "1";
                descriptionInput.addEventListener("change", function() {
                    const domain = this.dataset.nxeDomain;
                    if (!domain) return;
                    const value = this.value.trim();
                    if (value) descriptionsStore[domain] = value;
                    else delete descriptionsStore[domain];
                    saveSettings();
                });
            }
        });
    }

    function getListNameFromUrl() {
        return /allowlist/.test(location.href) ? "allowlist" : "denylist";
    }

    function allowDenyDomain(btn, listName) {
        const row = btn.closest('.nxe-log-row'); 
        if (!row) return;
        const domain = getDomainFromRow(row);
        
        if (!domain) return;
        
        const description = ReNXsettings.logsDomainDescriptions[domain] || "";
        
        const originalText = btn.innerHTML;
        btn.innerHTML = "...";
        btn.disabled = true;

        const payload = { id: domain };
        if (description && description.trim()) payload.description = description.trim();
        
        makeApiRequest("POST", listName, payload)
            .then(function() {
                row.style.display = "none";
            })
            .catch(function(err) {
                btn.innerHTML = "Err";
                btn.title = "Error: " + err;
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }, 2000);
            });
    }

    function hideLogEntry(target) {
        const row = target && target.classList && target.classList.contains('nxe-log-row') ? target : target.closest('.nxe-log-row');
        if (!row) return;
        const domain = getDomainFromRow(row);
        if (!domain) return;
        
        if (!ReNXsettings.hiddenDomains.includes(domain)) {
            ReNXsettings.hiddenDomains.push(domain);
            saveSettings();
        }
        row.style.display = "none";
        updateLogCountersDisplay(row.closest('.list-group'));
    }

    function exportToFile(obj, fileName) {
        const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(obj, null, 2));
        const a = document.createElement("a");
        a.setAttribute("href", data);
        a.setAttribute("download", fileName);
        safeAppend(document.body, a); 
        a.click();
        a.remove(); 
    }

    function createSpinner(btn) {
        const spinner = document.createElement("span");
        spinner.className = "spinner-border spinner-border-sm";
        spinner.style.marginLeft = "5px";
        safeAppend(btn, spinner);
    }

    function createPleaseWaitModal(text) {
        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style = "display: block; background: rgba(0,0,0,0.5); z-index: 10000;";
        modal.innerHTML = `<div class="modal-dialog modal-dialog-centered">
                            <div class="modal-content">
                                <div class="modal-body" style="text-align: center;">
                                    <span class="spinner-border spinner-border-sm" style="margin-right: 10px;"></span>
                                    ${text}...
                                </div>
                            </div>
                        </div>`;
        safeAppend(document.body, modal);
        return modal;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function saveSettings() {
        localStorage.setItem("ReNXsettings", JSON.stringify(ReNXsettings));
    }

    function loadReNXsettings() {
        return new Promise(function(resolve) {
            try {
                ReNXsettings = JSON.parse(localStorage.getItem("ReNXsettings")) || {};
            } catch (e) {
                console.error("[ReNX] Error loading settings, resetting:", e);
                ReNXsettings = {};
            }
            if (!ReNXsettings.logsDomainDescriptions) ReNXsettings.logsDomainDescriptions = {};
            if (!ReNXsettings.privacyBlocklistsCounters) ReNXsettings.privacyBlocklistsCounters = {};
            if (!ReNXsettings.allowlistDescriptions) ReNXsettings.allowlistDescriptions = {};
            if (!ReNXsettings.denylistDescriptions) ReNXsettings.denylistDescriptions = {};
            if (!ReNXsettings.hiddenDomains) ReNXsettings.hiddenDomains = [];
            if (typeof ReNXsettings.sortBlocklistsAZ === 'undefined') ReNXsettings.sortBlocklistsAZ = false;
            if (typeof ReNXsettings.sortListsAZ === 'undefined') ReNXsettings.sortListsAZ = false; 
            ReNXsettings.debugMode = (DEBUG_MODE_OVERRIDE === 1); 
            resolve();
        });
    }

    function sortList(containerElement, sortByText) {
        if (!containerElement || !containerElement.children) return;
        if (listObserver) listObserver.disconnect();

        const allListItems = Array.from(containerElement.querySelectorAll(".list-group-item"));
        const itemsToSort = allListItems.filter(item => {
            const hasGenericInput = item.querySelector('input[type="text"]:not(.description), input:not([type]), textarea');
            const isToolbar = item.id === "nxe-toolbar"; 
            const isHelpText = item.classList.contains("text-muted") || item.innerText.includes("Subdomains"); // Filter help text
            return !hasGenericInput && !isToolbar && !isHelpText;
        });

        if (itemsToSort.length > 0) {
            const getSortKey = (el) => {
                const domainSpan = el.querySelector("span"); 
                const rawText = domainSpan ? domainSpan.innerText.trim().toLowerCase() : el.innerText.trim().toLowerCase();
                const normalized = normalizeDomainValue(rawText);
                const root = getRootDomain(normalized || rawText);
                return `${root}|${normalized || rawText}`;
            };
            itemsToSort.sort((a, b) => {
                if (!sortByText) return 0;
                return getSortKey(a).localeCompare(getSortKey(b));
            });

            const inputRow = Array.from(containerElement.querySelectorAll(".list-group-item")).find(item => {
                 return item.querySelector('input[type="text"]:not(.description), input:not([type]), textarea');
            });
            
            itemsToSort.forEach(item => item.remove());

            if (inputRow) {
                itemsToSort.forEach(item => inputRow.insertAdjacentElement('afterend', item));
            } else {
                itemsToSort.forEach(item => safeAppend(containerElement, item));
            }
        }

        if (listObserver) listObserver.observe(containerElement, { childList: true });
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    function isPage(regex) {
        return regex.test(location.href);
    }

    const REGEX_LOGS = /\/logs/i;
    const REGEX_PRIVACY = /\/privacy\/?([?#].*)?$/i;
    const REGEX_SECURITY = /\/security\/?([?#].*)?$/i;
    const REGEX_LISTS = /\/(allowlist|denylist)\/?([?#].*)?$/i;
    const REGEX_SETTINGS = /\/settings\/?([?#].*)?$/i;

    let activeInterval = null;
    let isLargeListCache = null;
    let listObserver = null;
    let securityModalObserver = null; 
    let logMenuObserver = null;
    let logMenuScanInterval = null;

    function main() {
        if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
        if (listObserver) { listObserver.disconnect(); listObserver = null; }
        if (securityModalObserver) { securityModalObserver.disconnect(); securityModalObserver = null; }
        if (logMenuObserver) { logMenuObserver.disconnect(); logMenuObserver = null; }
        if (logMenuScanInterval) { clearInterval(logMenuScanInterval); logMenuScanInterval = null; }

        log("Main function started. Current URL:", location.href);
        isLargeListCache = null; 

        // --- LOGS PAGE ---
        if (isPage(REGEX_LOGS)) {
            activeInterval = setInterval(function() {
                if (!isPage(REGEX_LOGS)) { clearInterval(activeInterval); return; }

                const logsContainer = findLogsContainer();
                if (logsContainer && !document.getElementById("nxe-log-main-container")) { 
                    logsContainer.id = "nxe-log-main-container"; 
                    clearInterval(activeInterval); 
                    activeInterval = null;
                    log("Logs container found.");
                    initGlobalLogMenuObserver();
                    startLogMenuScan();
                    
                    processLogRowsFromNode(logsContainer, logsContainer);
                    updateLogCountersDisplay(logsContainer);

                    const logEntryObserver = new MutationObserver(function(mutations) {
                        if (!isPage(REGEX_LOGS)) { logEntryObserver.disconnect(); return; }
                        
                        mutations.forEach(mutation => {
                            mutation.addedNodes.forEach(node => {
                                if(node.nodeType === 1) {
                                    processLogRowsFromNode(node, logsContainer);
                                }
                            });
                        });
                        updateLogCountersDisplay(logsContainer);
                    });
                    logEntryObserver.observe(logsContainer, { childList: true, subtree: true });

                    // Scan interval fallback
                    const scanInterval = setInterval(() => {
                        if (!isPage(REGEX_LOGS)) { clearInterval(scanInterval); return; }
                        processLogRowsFromNode(logsContainer, logsContainer);
                        updateLogCountersDisplay(logsContainer);
                    }, 1000);
                    
                    if (!document.getElementById("resetHiddenBtn")) {
                        const resetHiddenBtn = document.createElement("button");
                        resetHiddenBtn.id = "resetHiddenBtn";
                        resetHiddenBtn.className = "btn btn-sm btn-outline-secondary";
                        resetHiddenBtn.innerHTML = "Reset Hidden Domains (0)";
                        resetHiddenBtn.style = "margin-bottom: 10px; display: block;";
                        resetHiddenBtn.onclick = function() {
                            ReNXsettings.hiddenDomains = [];
                            saveSettings();
                            document.querySelectorAll('.nxe-log-row').forEach(row => {
                                row.style.display = '';
                            });
                            updateLogCountersDisplay(logsContainer);
                        };
                        if(logsContainer.parentElement) logsContainer.parentElement.insertBefore(resetHiddenBtn, logsContainer);
                    }
                }
            }, 500);

        // --- PRIVACY PAGE ---
        } else if (isPage(REGEX_PRIVACY)) {
            activeInterval = setInterval(function() {
                if (!isPage(REGEX_PRIVACY)) { return; }

                if (document.querySelector(".card-body") != null) {
                    clearInterval(activeInterval);
                    activeInterval = null;
                    
                    document.querySelectorAll(".list-group-item").forEach(function(item) {
                        const switchInput = item.querySelector("input[type=checkbox]");
                        if (!switchInput) return;
                        const blocklistId = switchInput.id.match(/\d+/)[0];
                        const counterSpan = document.createElement("span");
                        counterSpan.className = "text-muted small";
                        counterSpan.style = "position: absolute; right: 70px;";
                        counterSpan.innerHTML = ReNXsettings.privacyBlocklistsCounters[blocklistId] || "0";
                        safeAppend(item.querySelector(".form-check"), counterSpan);
                        switchInput.onchange = function() {
                            ReNXsettings.privacyBlocklistsCounters[blocklistId] = "...";
                            saveSettings();
                            counterSpan.innerHTML = "...";
                        };
                    });

                    const addBlocklistBtn = document.querySelector(".card-footer button");
                    if (addBlocklistBtn) {
                        addBlocklistBtn.onclick = function() {
                            const waitForListsModal = setInterval(function() {
                                if (!isPage(REGEX_PRIVACY)) { clearInterval(waitForListsModal); return; }
                                if (document.querySelector(".modal-body .list-group-item") != null) {
                                    clearInterval(waitForListsModal);
                                    const modalHeader = document.querySelector(".modal-header");
                                    if (!modalHeader.querySelector("#sortAZSwitch")) {
                                        const sortContainer = document.createElement("div");
                                        sortContainer.className = "form-check form-switch";
                                        sortContainer.style = "position: absolute; right: 50px; bottom: 15px;";
                                        const sortInput = document.createElement("input");
                                        sortInput.className = "form-check-input";
                                        sortInput.type = "checkbox";
                                        sortInput.id = "sortAZSwitch";
                                        sortInput.checked = ReNXsettings.sortBlocklistsAZ;
                                        const sortLabel = document.createElement("label");
                                        sortLabel.className = "form-check-label";
                                        sortLabel.htmlFor = "sortAZSwitch";
                                        sortLabel.innerText = "Sort A-Z";
                                        sortInput.onchange = function() {
                                            ReNXsettings.sortBlocklistsAZ = this.checked;
                                            saveSettings();
                                            const list = document.querySelector(".modal-body .list-group");
                                            if (this.checked && list) sortList(list, true);
                                        };
                                        safeAppend(sortContainer, sortInput);
                                        safeAppend(sortContainer, sortLabel);
                                        safeAppend(modalHeader, sortContainer);
                                        
                                        const list = document.querySelector(".modal-body .list-group");
                                        if (ReNXsettings.sortBlocklistsAZ && list) sortList(list, true);
                                    }
                                }
                            }, 100);
                        };
                    }
                }
            }, 500);

        // --- SECURITY PAGE ---
        } else if (isPage(REGEX_SECURITY)) {
            securityModalObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes.length > 0) {
                        const modalContent = document.querySelector('.modal-content');
                        if (modalContent) {
                            const checkForTLDModal = setInterval(() => {
                                if (!document.querySelector('.modal-content')) { 
                                    clearInterval(checkForTLDModal);
                                    return;
                                }
                                
                                const modalHeader = document.querySelector(".modal-header");
                                const isTLDModal = modalHeader && (modalHeader.innerText.includes("TLD") || modalHeader.innerText.includes("Top-Level"));

                                if (isTLDModal) {
                                    clearInterval(checkForTLDModal);
                                    log("TLD Modal detected by Header. Injecting buttons.");
                                    
                                    let injectionTarget = document.querySelector(".modal-footer"); 
                                    if (!injectionTarget) {
                                        const modalContent = document.querySelector(".modal-content");
                                        injectionTarget = document.createElement("div");
                                        injectionTarget.className = "modal-footer d-flex justify-content-end";
                                        injectionTarget.style.gap = "10px";
                                        if (modalContent) safeAppend(modalContent, injectionTarget);
                                    }
                                    if (!injectionTarget) injectionTarget = modalHeader;
                                    if (injectionTarget && !injectionTarget.style.gap) injectionTarget.style.gap = "10px";

                                    if (injectionTarget && !document.getElementById("removeAllTLDsBtn")) {
                                        const removeAllBtn = document.createElement("button");
                                        removeAllBtn.id = "removeAllTLDsBtn";
                                        removeAllBtn.className = "btn btn-sm btn-secondary"; 
                                        removeAllBtn.style.display = "inline-block";
                                        removeAllBtn.style.zIndex = "9999";
                                        removeAllBtn.innerText = "Remove all TLDs";
                                        removeAllBtn.onclick = async function() {
                                            if (!confirm("WARNING: This will remove ALL blocked TLDs.\nThis action cannot be undone.\nAre you absolutely sure?")) return;
                                            const modal = createPleaseWaitModal("Removing all TLDs...");
                                            try {
                                                const payload = { "tlds": [] }; 
                                                await makeApiRequest("PATCH", "security", payload); 
                                                modal.remove();
                                                location.reload();
                                            } catch (err) {
                                                console.error("Failed to remove all TLDs:", err);
                                                modal.remove();
                                                alert("Failed to remove all TLDs. See console for details.");
                                            }
                                        };
                                        safeAppend(injectionTarget, removeAllBtn);
                                    }
                                }
                            }, 200);
                        }
                    }
                });
            });
            
            securityModalObserver.observe(document.body, { childList: true, subtree: false });

            activeInterval = setInterval(function() {
                if (!isPage(REGEX_SECURITY)) { return; }

                if (document.querySelector(".card-body") != null) {
                    clearInterval(activeInterval);
                    activeInterval = null;
                    
                    document.querySelectorAll(".form-check").forEach(function(item) {
                        const switchInput = item.querySelector("input[type=checkbox]");
                        if (!switchInput || switchInput.id.includes("web3")) return;
                        const tooltipParent = document.createElement("div");
                        tooltipParent.className = "tooltipParent";
                        tooltipParent.style = "display: contents;";
                        tooltipParent.innerHTML = item.querySelector("label").innerHTML;
                        const tooltip = document.createElement("div");
                        tooltip.className = "customTooltip text-muted small";
                        tooltip.style = "position: absolute; z-index: 1; top: 25px; background: #000; color: #fff; padding: 5px; border-radius: 5px; opacity: 0; visibility: hidden; transition: opacity .2s;";
                        tooltip.innerHTML = switchInput.checked ? "Enabled" : "Disabled";
                        safeAppend(tooltipParent, tooltip);
                        safeAppend(item.querySelector("label"), tooltipParent);
                        switchInput.onchange = function() {
                            tooltip.innerHTML = this.checked ? "Enabled" : "Disabled";
                        };
                    });
                }
            }, 500);

        // --- ALLOWLIST / DENYLIST PAGES ---
        } else if (isPage(REGEX_LISTS)) {
            activeInterval = setInterval(function() {
                if (!isPage(REGEX_LISTS)) { 
                    clearInterval(activeInterval); 
                    activeInterval = null;
                    if (listObserver) { listObserver.disconnect(); listObserver = null; }
                    return; 
                }

                const listGroups = document.querySelectorAll(".list-group");
                let listGroup = null;
                
                listGroups.forEach(lg => {
                    if (!lg.querySelector('input[placeholder*="Add a domain"]') && !lg.querySelector('input[placeholder*="Domain hinzufügen"]')) {
                        listGroup = lg;
                    }
                });
                
                if (!listGroup && listGroups.length > 1) {
                    listGroup = listGroups[1];
                }

                if (listGroup) {
                    const listName = getListNameFromUrl(); 

                    if (!document.getElementById("nxe-toolbar")) {
                        const listItems = listGroup.querySelectorAll(".list-group-item");
                        isLargeListCache = listItems.length > 1000; 
                        log(`List: ${listName}, Size: ${listItems.length}. Large List Mode: ${isLargeListCache}`);

                        const toolbar = document.createElement("div");
                        toolbar.className = "nxe-toolbar";
                        toolbar.id = "nxe-toolbar"; 
                        
                        if (isLargeListCache) {
                            const warning = document.createElement("div");
                            warning.className = "nxe-warning";
                            warning.innerText = `Large list detected (${listItems.length} items). DOM enhancements disabled. Use 'Clear Entire List' below.`;
                            safeAppend(toolbar, warning);
                        }

                        const clearListBtn = document.createElement("button");
                        clearListBtn.className = "btn btn-sm btn-danger";
                        clearListBtn.innerText = "Clear Entire List";
                        clearListBtn.style.marginLeft = "auto"; 
                        clearListBtn.onclick = async function() {
                            if (!confirm(`WARNING: This will delete ALL items in the ${listName}!

This action cannot be undone.

Are you absolutely sure?`)) return;
                            
                            const modal = createPleaseWaitModal("Clearing list... This may take a few seconds");
                            
                            const payload = {};
                            payload[listName] = []; 
                            
                            try {
                                await makeApiRequest("PATCH", "", payload); 
                                
                                modal.querySelector(".modal-body").innerHTML = '<span class="spinner-border spinner-border-sm" style="margin-right: 10px;"></span>Verifying deletion...';
                                
                                let retries = 0;
                                let isCleared = false;
                                while (retries < 30) { 
                                    await sleep(1000);
                                    try {
                                        const response = await makeApiRequest("GET", listName);
                                        const json = JSON.parse(response);
                                        if (json.data && json.data.length === 0) {
                                            isCleared = true;
                                            break;
                                        }
                                    } catch (e) { console.warn("Verification check failed", e); }
                                    retries++;
                                }

                                modal.remove();
                                if(!isCleared) alert("Command sent, but list not yet empty. Please refresh manually in a few seconds.");
                                location.reload();
                            } catch (err) {
                                console.error("Failed to clear list", err);
                                modal.remove();
                                alert("Failed to clear list. See console for details.");
                            }
                        };
                        safeAppend(toolbar, clearListBtn);

                        const bulkAddBtn = document.createElement("button");
                        bulkAddBtn.className = "btn btn-sm btn-secondary";
                        bulkAddBtn.innerText = "Bulk Add";
                        bulkAddBtn.onclick = function() {
                            const inputContainer = document.querySelector("form");
                            if (inputContainer) {
                                let input = inputContainer.querySelector("input");
                                if (input && input.type !== "textarea") {
                                    const textarea = document.createElement("textarea");
                                    textarea.className = input.className;
                                    textarea.placeholder = "Enter domains, one per line...";
                                    textarea.id = "nxe-bulk-textarea"; 
                                    textarea.style.height = "100px";
                                    textarea.style.width = "100%";
                                    input.replaceWith(textarea);
                                    const bulkSubmitBtn = document.createElement("button");
                                    bulkSubmitBtn.className = "btn btn-primary mt-2";
                                    bulkSubmitBtn.innerText = "Submit Bulk";
                                    bulkSubmitBtn.onclick = async function(e) {
                                        e.preventDefault();
                                        const currentList = getListNameFromUrl(); 
                                        const domains = textarea.value.split("\n").map(d => d.trim()).filter(d => d);
                                        if (domains.length === 0) return;
                                        const modal = createPleaseWaitModal(`Adding ${domains.length} domains`);
                                        const existing = new Set(Array.from(document.querySelectorAll(".list-group-item span"))
                                            .map(span => normalizeDomainValue(span.textContent))
                                            .filter(Boolean));
                                        let processed = 0;
                                for (let domain of domains) { 
                                            processed++;
                                            if (existing.has(normalizeDomainValue(domain))) {
                                                modal.querySelector(".modal-body").innerText = `Skipping existing ${processed}/${domains.length}: ${domain}`;
                                                continue;
                                            }
                                            modal.querySelector(".modal-body").innerText = `Adding ${processed}/${domains.length}: ${domain}`;
                                            try { await makeApiRequest("POST", currentList, { id: domain, active: true }); } 
                                            catch (err) { console.error("Failed to add", domain, err); }
                                            await sleep(1000);
                                }
                                        modal.remove();
                                        location.reload();
                                    };
                                    safeAppend(textarea.parentElement, bulkSubmitBtn);
                                }
                            }
                        };
                        toolbar.insertBefore(bulkAddBtn, toolbar.firstChild);

                        if (!isLargeListCache) {
                            const sortToggle = document.createElement("div");
                            sortToggle.className = "form-check form-switch d-inline-block ms-3";
                            sortToggle.style.marginLeft = "10px";
                            sortToggle.style.marginRight = "10px";
                            
                            const sortInput = document.createElement("input");
                            sortInput.className = "form-check-input nxe-sort-toggle";
                            sortInput.type = "checkbox";
                            sortInput.id = "sortListAZ";
                            sortInput.checked = ReNXsettings.sortListsAZ;
                            
                            const sortLabel = document.createElement("label");
                            sortLabel.className = "form-check-label";
                            sortLabel.htmlFor = "sortListAZ";
                            sortLabel.innerText = "Sort A-Z";
                            sortLabel.style.marginLeft = "5px";

                            sortInput.onchange = function() {
                                ReNXsettings.sortListsAZ = this.checked;
                                saveSettings();
                                if (this.checked) {
                                    sortList(listGroup, true);
                                } else {
                                    location.reload(); 
                                }
                            };

                            safeAppend(sortToggle, sortInput);
                            safeAppend(sortToggle, sortLabel);
                            toolbar.insertBefore(sortToggle, bulkAddBtn.nextSibling);

                            if (ReNXsettings.sortListsAZ) {
                                sortList(listGroup, true);
                            }
                        }

                        if (!isLargeListCache) { 
                            const bulkDeleteBtn = document.createElement("button");
                            bulkDeleteBtn.className = "btn btn-sm btn-danger";
                            bulkDeleteBtn.innerText = "Delete Selected";
                            bulkDeleteBtn.style.marginLeft = "10px";
                            bulkDeleteBtn.onclick = async function() {
                                const currentList = getListNameFromUrl(); 
                                let checkedBoxes = Array.from(document.querySelectorAll(".nxe-select-checkbox:checked"));
                                if (checkedBoxes.length === 0) { alert("Please select domains to delete first."); return; }
                                if (checkedBoxes.length > 20) {
                                    if (!confirm(`You selected ${checkedBoxes.length} domains.
To prevent rate-limiting errors (429), we will only delete the first 20 items now.

Do you want to proceed?`)) return;
                                    checkedBoxes = checkedBoxes.slice(0, 20);
                                } else {
                                    if (!confirm(`Are you sure you want to delete ${checkedBoxes.length} domains from the ${currentList}?`)) return;
                                }
                                const modal = createPleaseWaitModal(`Deleting ${checkedBoxes.length} domains`);
                                for (let box of checkedBoxes) {
                                    const item = box.parentElement; 
                                    const domainSpan = item.querySelector("span");
                                    if (domainSpan) {
                                        const domain = domainSpan.innerHTML.match(/[^>]+$/) ? domainSpan.innerHTML.match(/[^>]+$/)[0] : domainSpan.innerText;
                                        try { await makeApiRequest("DELETE", currentList + "/hex:" + convertToHex(domain)); } 
                                        catch (err) { console.error("Failed to delete", domain, err); }
                                    }
                                    await sleep(1000);
                                }
                                modal.remove();
                                location.reload();
                            };
                            toolbar.insertBefore(bulkDeleteBtn, clearListBtn);

                            const selectAllContainer = document.createElement("div");
                            selectAllContainer.style.marginLeft = "10px"; 
                            const selectAllBox = document.createElement("input");
                            selectAllBox.type = "checkbox";
                            selectAllBox.className = "nxe-select-checkbox";
                            selectAllBox.id = "nxe-select-all-checkbox";
                            selectAllBox.title = "Select All";
                            selectAllBox.onchange = function() {
                                document.querySelectorAll(".nxe-select-checkbox").forEach(box => {
                                    if (box !== selectAllBox) box.checked = selectAllBox.checked;
                                });
                            };
                            selectAllContainer.appendChild(document.createTextNode("Select All "));
                            safeAppend(selectAllContainer, selectAllBox);
                            toolbar.insertBefore(selectAllContainer, bulkDeleteBtn);
                        }
                        if (listGroup.parentElement) { 
                            listGroup.parentElement.insertBefore(toolbar, listGroup);
                        } else {
                            safeAppend(listGroup, toolbar); 
                        }

                        if (!isLargeListCache) {
                            const debouncedSort = debounce(() => {
                                if (ReNXsettings.sortListsAZ) sortList(listGroup, true);
                            }, 500);
                            const debouncedEnhance = debounce(() => enhanceListItems(listGroup, listName), 300);
                            
                            if (listObserver) listObserver.disconnect();
                            
                            listObserver = new MutationObserver(() => {
                                debouncedEnhance();
                                debouncedSort();
                            });
                            listObserver.observe(listGroup, { childList: true });
                        }
                    }

                    if (!isLargeListCache) { 
                        enhanceListItems(listGroup, listName);
                    }
                }
            }, 1000);

        // --- SETTINGS PAGE ---
        } else if (isPage(REGEX_SETTINGS)) {
            const waitForContent = setInterval(function() {
                if (!isPage(REGEX_SETTINGS)) { clearInterval(activeInterval); return; }

                if (document.querySelector(".card-body") != null) {
                    clearInterval(activeInterval);
                    activeInterval = null;
                    
                    if(document.getElementById("nxe-settings-injected")) return; // Fix duplicate buttons

                    const exportConfigButton = document.createElement("button");
                    exportConfigButton.className = "btn btn-primary";
                    exportConfigButton.innerHTML = "Export this config";
                    exportConfigButton.onclick = function() {
                        const config = {};
                        const pages = ["security", "privacy", "parentalcontrol", "denylist", "allowlist", "settings", "rewrites"];
                        const configName = this.parentElement.previousSibling.querySelector("input").value;
                        let numPagesExported = 0;
                        createSpinner(this);
                        pages.forEach(function(page) {
                            makeApiRequest("GET", page).then(function(response) {
                                config[page] = JSON.parse(response).data;
                                numPagesExported++;
                                if (numPagesExported == pages.length) {
                                    config.privacy.blocklists = config.privacy.blocklists.map(b => ({ id: b.id }));
                                    config.rewrites = config.rewrites.map(r => ({ name: r.name, content: r.content }));
                                    config.parentalcontrol.services = config.parentalcontrol.services.map(s => ({ id: s.id, active: s.active, recreation: s.recreation }));
                                    const fileName = configName + "-" + location.href.split("/")[3] + "-Export.json";
                                    exportToFile(config, fileName);
                                    exportConfigButton.lastChild.remove();
                                }
                            });
                        });
                    };
                    const importConfigButton = document.createElement("button");
                    importConfigButton.className = "btn btn-primary";
                    importConfigButton.innerHTML = "Import a config";
                    importConfigButton.onclick = function() { this.nextSibling.click(); };
                    const fileConfigInput = document.createElement("input");
                    fileConfigInput.type = "file";
                    fileConfigInput.style = "display: none;";
                    fileConfigInput.onchange = function() {
                        const file = new FileReader();
                        file.onload = async function() {
                            const config = JSON.parse(this.result);
                            const numItemsImported = { denylist: 0, allowlist: 0, rewrites: 0 };
                            const numFinishedRequests = { denylist: 0, allowlist: 0, rewrites: 0 };
                            const importIndividualItems = async function(listName) {
                                let listObj = config[listName];
                                listObj.reverse();
                                for (let i = 0; i < listObj.length; i++) {
                                    await sleep(1000);
                                    const item = listObj[i];
                                    makeApiRequest("POST", listName, item)
                                        .then(function(response) {
                                            if (!response.includes("error") || response.includes("duplicate") || response.includes("conflict")) {
                                                numItemsImported[listName]++;
                                            }
                                        })
                                        .catch(function(response) {
                                            console.error(`Error importing ${listName} item:`, response);
                                        })
                                        .finally(function() {
                                            numFinishedRequests[listName]++;
                                        });
                                }
                            };
                            try {
                                log("Importing security settings...");
                                await makeApiRequest("PATCH", "security", config.security);
                                log("Security settings imported.");
                            } catch (error) {
                                console.error("Error importing security settings:", error);
                            }
                            try {
                                log("Importing privacy settings...");
                                await makeApiRequest("PATCH", "privacy", config.privacy);
                                log("Privacy settings imported.");
                            } catch (error) {
                                console.error("Error importing privacy settings:", error);
                            }
                            if (config.parentalcontrol) {
                                const parentalControlData = {
                                    safeSearch: config.parentalcontrol.safeSearch,
                                    youtubeRestrictedMode: config.parentalcontrol.youtubeRestrictedMode,
                                    blockBypass: config.parentalcontrol.blockBypass,
                                    services: config.parentalcontrol.services ? config.parentalcontrol.services.map(service => ({ id: service.id, active: service.active })) : [],
                                    categories: config.parentalcontrol.categories ? config.parentalcontrol.categories.map(category => ({ id: category.id, active: category.active })) : []
                                };
                                try {
                                    log("Importing parental control settings...");
                                    await makeApiRequest("PATCH", "parentalcontrol", parentalControlData);
                                    log("Parental control settings imported.");
                                } catch (error) {
                                    console.error("Error importing parental control settings:", error);
                                }
                            }
                            try {
                                log("Importing settings...");
                                await makeApiRequest("PATCH", "settings", config.settings);
                                log("Settings imported.");
                            } catch (error) {
                                console.error("Error importing settings:", error);
                            }
                            importIndividualItems("rewrites");
                            importIndividualItems("denylist");
                            importIndividualItems("allowlist");
                            setInterval(function() {
                                if (numFinishedRequests.denylist === config.denylist.length &&
                                    numFinishedRequests.allowlist === config.allowlist.length &&
                                    numFinishedRequests.rewrites === config.rewrites.length) {
                                    log("All import requests have finished.");
                                    log(`Imported items - Denylist: ${numItemsImported.denylist}/${config.denylist.length}, ` +
                                                `Allowlist: ${numItemsImported.allowlist}/${config.allowlist.length}, ` +
                                                `Rewrites: ${numItemsImported.rewrites}/${config.rewrites.length}`);
                                    setTimeout(() => location.reload(), 1000);
                                }
                            }, 1000);
                        };
                        file.readAsText(this.files[0]);
                        createPleaseWaitModal("Importing configuration");
                    };
                    const container = document.createElement("div");
                    container.id = "nxe-settings-injected";
                    container.style = "display: flex; grid-gap: 20px; margin-top: 20px;";
                    safeAppend(container, exportConfigButton);
                    safeAppend(container, importConfigButton);
                    safeAppend(container, fileConfigInput);
                    document.querySelector(".card-body").appendChild(container);
                }
            }, 500);
        }
    }

    // Load settings and run main function
    let ReNXsettings;
    loadReNXsettings().then(() => {
        log("Script initialized.");
        main();
        let currentPage = location.href;
        setInterval(function() {
            if (currentPage !== location.href) {
                log("URL change detected: " + location.href + ". Rerunning main().");
                currentPage = location.href;
                main();
            }
        }, 250);
    });
})();
