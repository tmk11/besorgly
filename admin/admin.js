const API_BASE = "/api/admin";

const statusLabels = {
    new: "Neu",
    deposit_pending: "Anzahlung offen",
    accepted: "Angenommen",
    shopping: "Beim Einkauf",
    delivered: "Geliefert",
    rejected: "Abgelehnt",
    cancelled: "Storniert",
};

const state = {
    orders: [],
    selectedOrderId: null,
    activeView: "time",
};

const loginCard = document.querySelector("#loginCard");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const adminPassword = document.querySelector("#adminPassword");
const refreshOrders = document.querySelector("#refreshOrders");
const logoutButton = document.querySelector("#logoutButton");
const searchInput = document.querySelector("#searchInput");
const statusFilter = document.querySelector("#statusFilter");
const viewTabs = document.querySelectorAll(".view-tab");
const ordersList = document.querySelector("#ordersList");
const ordersCount = document.querySelector("#ordersCount");
const ordersTitle = document.querySelector("#ordersTitle");
const detailPanel = document.querySelector("#detailPanel");

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
        };
        return entities[character];
    });
}

function formatDate(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

function statusBadge(status) {
    return `<span class="status ${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span>`;
}

function orderContentSummary(order) {
    const parts = [];

    if (order.hasShoppingListText) {
        parts.push("Einkaufsliste");
    }

    if (order.itemCount) {
        parts.push(`${order.itemCount} Produkt${order.itemCount === 1 ? "" : "e"}`);
    }

    if (order.photoCount) {
        parts.push(`${order.photoCount} Foto${order.photoCount === 1 ? "" : "s"}`);
    }

    if (order.cheapestPreference) {
        parts.push("günstigste passende Variante");
    }

    return parts.length ? parts.join(" · ") : "Keine Einkaufsliste oder Fotos";
}

function photosForItem(item, photos) {
    const prefixes = (item.photos || [])
        .map((photo) => photo.uploadPrefix)
        .filter(Boolean);

    if (prefixes.length === 0) {
        return [];
    }

    return photos.filter((photo) => prefixes.some((prefix) => String(photo.filename || "").includes(prefix)));
}

function renderItemPhotos(item, photos) {
    const matchedPhotos = photosForItem(item, photos);

    if (matchedPhotos.length === 0) {
        return "";
    }

    return `
        <div class="item-photos-grid">
            ${matchedPhotos.map((photo) => `
                <a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">
                    <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.filename)}">
                </a>
            `).join("")}
        </div>
    `;
}

async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
        throw new Error(result.error || "api_error");
    }

    return result;
}

function showDashboard() {
    loginCard.hidden = true;
    dashboard.hidden = false;
}

function showLogin(message = "") {
    dashboard.hidden = true;
    loginCard.hidden = false;
    loginMessage.textContent = message;
    adminPassword.focus();
}

async function checkSession() {
    try {
        const result = await apiFetch("/session");
        if (result.authenticated) {
            showDashboard();
            await loadOrders();
            return;
        }
    } catch {
        // Ignore and show login.
    }

    showLogin();
}

async function login(event) {
    event.preventDefault();
    loginMessage.textContent = "Login wird geprüft ...";

    try {
        await apiFetch("/login", {
            method: "POST",
            body: JSON.stringify({ password: adminPassword.value }),
        });
        adminPassword.value = "";
        showDashboard();
        await loadOrders();
    } catch {
        showLogin("Passwort ist nicht korrekt.");
    }
}

async function logout() {
    try {
        await apiFetch("/logout", { method: "POST", body: "{}" });
    } catch {
        // Session may already be gone.
    }

    state.orders = [];
    state.selectedOrderId = null;
    renderOrders();
    showLogin("Sie wurden ausgeloggt.");
}

async function loadOrders() {
    const query = new URLSearchParams({
        search: searchInput.value.trim(),
        status: statusFilter.value,
    });

    try {
        const result = await apiFetch(`/orders?${query.toString()}`);
        state.orders = result.orders || [];
        renderOrders();
    } catch {
        showLogin("Bitte erneut einloggen.");
    }
}

function parseDeliveryBlockEnd(deliveryTime) {
    const match = String(deliveryTime || "").match(/(\d{2})\.(\d{2})\.(\d{4}).*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
    if (!match) {
        return null;
    }

    const [, day, month, year, , , endHour, endMinute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(endHour), Number(endMinute));
    return Number.isNaN(date.getTime()) ? null : date;
}

function isHistoryOrder(order) {
    if (["delivered", "rejected", "cancelled"].includes(order.status)) {
        return true;
    }

    const blockEnd = parseDeliveryBlockEnd(order.deliveryTime);
    return Boolean(blockEnd && blockEnd < new Date());
}

function deliveryBlockLabel(order) {
    return order.deliveryTime || "Ohne Zeitfenster";
}

function deliveryBlockSortValue(label) {
    const blockEnd = parseDeliveryBlockEnd(label);
    return blockEnd ? blockEnd.getTime() : Number.MAX_SAFE_INTEGER;
}

function supermarketsForOrder(order) {
    const supermarkets = Array.isArray(order.supermarkets) ? order.supermarkets : [];
    return supermarkets.length ? supermarkets : ["Per Foto / noch klären"];
}

function groupOrders(orders, keyFn) {
    return orders.reduce((groups, order) => {
        const keys = keyFn(order);
        keys.forEach((key) => {
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(order);
        });
        return groups;
    }, new Map());
}

function viewTitle() {
    if (state.activeView === "market") {
        return "Nach Supermarkt";
    }

    if (state.activeView === "history") {
        return "Historie";
    }

    return "Aktuelle Zeitblöcke";
}

function renderOrderCard(order) {
    const supermarketText = supermarketsForOrder(order).join(", ");
    const entryModeText = order.entryMode === "products" ? "Produkte eingegeben" : "Zettel/Fotos";

    return `
        <button class="order-card ${order.orderId === state.selectedOrderId ? "active" : ""}" type="button" data-id="${escapeHtml(order.orderId)}">
            <div class="order-card-header">
                <span>${escapeHtml(order.orderId)}</span>
                ${statusBadge(order.status)}
            </div>
            <strong>${escapeHtml(order.customerName || "Ohne Name")}</strong>
            <p>${escapeHtml(order.phone || "Keine Telefonnummer")}</p>
            <p>${escapeHtml(order.address || "Keine Adresse")}</p>
            <p><strong>Zeit:</strong> ${escapeHtml(order.deliveryTime || "Ohne Zeitfenster")}</p>
            <p><strong>Markt:</strong> ${escapeHtml(supermarketText)}</p>
            <p>${formatDate(order.createdAt)} · ${escapeHtml(entryModeText)} · ${escapeHtml(orderContentSummary(order))}</p>
            ${order.shoppingListPreview ? `<p class="order-preview">${escapeHtml(order.shoppingListPreview)}</p>` : ""}
        </button>
    `;
}

function renderOrderGroup(title, orders, subtitle = "") {
    return `
        <section class="order-group">
            <header class="order-group-header">
                <div>
                    <h3>${escapeHtml(title)}</h3>
                    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
                </div>
                <span>${orders.length}</span>
            </header>
            <div class="order-group-list">
                ${orders.map(renderOrderCard).join("")}
            </div>
        </section>
    `;
}

function renderGroupedOrders(groups, sortFn, subtitleFn = () => "") {
    const entries = [...groups.entries()].sort(sortFn);
    return entries.map(([title, orders]) => renderOrderGroup(title, orders, subtitleFn(title, orders))).join("");
}

function renderOrders() {
    const historyOrders = state.orders.filter(isHistoryOrder);
    const currentOrders = state.orders.filter((order) => !isHistoryOrder(order));
    const displayedOrders = state.activeView === "history" ? historyOrders : currentOrders;

    ordersTitle.textContent = viewTitle();
    ordersCount.textContent = displayedOrders.length;
    viewTabs.forEach((tab) => {
        const active = tab.dataset.view === state.activeView;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-pressed", String(active));
    });

    if (displayedOrders.length === 0) {
        ordersList.innerHTML = '<p class="muted empty-orders-message">Keine Bestellungen in dieser Ansicht.</p>';
        return;
    }

    if (state.activeView === "market") {
        const groups = groupOrders(displayedOrders, supermarketsForOrder);
        ordersList.innerHTML = renderGroupedOrders(
            groups,
            ([firstTitle], [secondTitle]) => firstTitle.localeCompare(secondTitle, "de"),
            (title) => title === "Per Foto / noch klären" ? "Bestellungen ohne festen Supermarkt" : "Gemeinsame Tour vorbereiten",
        );
        return;
    }

    const groups = groupOrders(displayedOrders, (order) => [deliveryBlockLabel(order)]);
    ordersList.innerHTML = renderGroupedOrders(
        groups,
        ([firstTitle], [secondTitle]) => deliveryBlockSortValue(firstTitle) - deliveryBlockSortValue(secondTitle),
        (title, orders) => state.activeView === "history"
            ? `${orders.length} erledigte oder abgelaufene Bestellung${orders.length === 1 ? "" : "en"}`
            : "Aktiver Lieferblock",
    );
}

async function selectOrder(event) {
    const card = event.target.closest(".order-card");
    if (!card) {
        return;
    }

    state.selectedOrderId = card.dataset.id;
    renderOrders();
    detailPanel.innerHTML = '<div class="empty-detail"><p>Bestellung wird geladen ...</p></div>';

    try {
        const result = await apiFetch(`/orders/${encodeURIComponent(state.selectedOrderId)}`);
        renderOrderDetail(result.order);
    } catch {
        detailPanel.innerHTML = '<div class="empty-detail"><p>Bestellung konnte nicht geladen werden.</p></div>';
    }
}

function renderOrderDetail(order) {
    const payload = order.payload || {};
    const customer = payload.customer || {};
    const items = payload.items || [];
    const fees = payload.fees || {};
    const deposit = payload.deposit || {};
    const loyalty = order.loyaltyStats || {};
    const photos = order.photos || [];
    const admin = order.admin || { status: "new", note: "" };
    const shoppingListText = String(payload.shoppingListText || "").trim();
    const cheapestPreference = Boolean(payload.cheapestPreference);
    const entryModeLabel = payload.entryMode === "products" ? "Produkte direkt eingegeben" : "Einkaufszettel per Foto";

    detailPanel.innerHTML = `
        <div class="detail-top">
            <div>
                <h2>${escapeHtml(order.orderId)}</h2>
                <p class="muted">${formatDate(order.createdAt)}</p>
            </div>
            ${statusBadge(admin.status || "new")}
        </div>

        <form class="detail-section" id="statusForm">
            <h3>Status & interne Notiz</h3>
            <div class="detail-actions">
                <label>
                    <span>Status</span>
                    <select id="detailStatus">
                        ${Object.entries(statusLabels).map(([value, label]) => `
                            <option value="${value}" ${value === admin.status ? "selected" : ""}>${label}</option>
                        `).join("")}
                    </select>
                </label>
                <button class="button button-primary" type="submit">Speichern</button>
            </div>
            <label>
                <span>Interne Notiz</span>
                <textarea id="adminNote" placeholder="Zum Beispiel: Kunde angerufen, Lieferung geplant ...">${escapeHtml(admin.note || "")}</textarea>
            </label>
        </form>

        <div class="detail-meta">
            <div class="meta-box"><span>Name</span><strong>${escapeHtml(customer.name)}</strong></div>
            <div class="meta-box"><span>Telefon</span><strong>${escapeHtml(customer.phone)}</strong></div>
            <div class="meta-box"><span>Adresse</span><strong>${escapeHtml(customer.address)}</strong></div>
            <div class="meta-box"><span>Kontakt</span><strong>${escapeHtml(customer.contactWay || "-")}</strong></div>
            <div class="meta-box"><span>Lieferzeitfenster</span><strong>${escapeHtml(customer.deliveryTime || "-")}</strong></div>
            <div class="meta-box"><span>Eingabeart</span><strong>${escapeHtml(entryModeLabel)}</strong></div>
            <div class="meta-box"><span>Geschätzter Warenwert</span><strong>${escapeHtml(customer.estimatedOrderValue || "-")} €</strong></div>
            <div class="meta-box"><span>Servicegebühr</span><strong>${fees.totalServiceFee ?? "-"} €</strong></div>
            <div class="meta-box"><span>Free Ship</span><strong>${payload.loyalty?.freeShippingUsed ? "Ja" : "Nein"}</strong></div>
            ${deposit.required ? `
                <div class="meta-box"><span>Anzahlung</span><strong>10,00 € erforderlich</strong></div>
                <div class="meta-box"><span>Zahlungsnotiz</span><strong>${escapeHtml(deposit.note || customer.phone || "-")}</strong></div>
            ` : ""}
        </div>

        <section class="detail-section">
            <h3>Treuepunkte</h3>
            <p><strong>${loyalty.stampCount ?? 0}/${loyalty.targetOrders ?? 8}</strong> Punkte · ${loyalty.availableFreeShipCount ?? 0} kostenlose Lieferung verfügbar</p>
            <p class="muted">Punkte zählen für erfolgreich gespeicherte Bestellungen, solange sie nicht als „Abgelehnt“ markiert wurden.</p>
        </section>

        <section class="detail-section">
            <h3>Einkaufsliste</h3>
            ${shoppingListText ? `
                <pre class="order-text shopping-list-text">${escapeHtml(shoppingListText)}</pre>
                <p class="muted">${cheapestPreference ? "Kundenwunsch: Wenn möglich die günstigste passende Variante kaufen." : "Kundenwunsch: Angaben und Fotos beachten."}</p>
            ` : '<p class="muted">Keine Einkaufsliste als Text eingetragen.</p>'}
        </section>

        <section class="detail-section">
            <h3>Produkte</h3>
            <div class="items-list">
                ${items.length ? items.map((item) => `
                    <div class="item-line">
                        <strong>${escapeHtml(item.quantity || "Menge offen")} ${escapeHtml(item.name || "Produkt per Foto")}</strong><br>
                        <span>${escapeHtml(item.supermarket || "Egal")} · ${item.preference === "cheapest" ? "günstigste passende Variante" : "bestimmter Artikel / Foto beachten"}</span>
                        ${item.details ? `<p class="muted">${escapeHtml(item.details)}</p>` : ""}
                        ${renderItemPhotos(item, photos)}
                    </div>
                `).join("") : '<p class="muted">Keine Produkte eingetragen. Bitte Einkaufsliste und Fotos prüfen.</p>'}
            </div>
        </section>

        <section class="detail-section">
            <h3>Fotos</h3>
            <div class="photos-grid">
                ${photos.length ? photos.map((photo) => `
                    <a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">
                        <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.filename)}">
                    </a>
                `).join("") : '<p class="muted">Keine Fotos hochgeladen.</p>'}
            </div>
        </section>

        <section class="detail-section">
            <h3>Bestelltext</h3>
            <pre class="order-text">${escapeHtml(order.orderText || "")}</pre>
        </section>
    `;

    document.querySelector("#statusForm").addEventListener("submit", (event) => saveStatus(event, order.orderId));
}

async function saveStatus(event, orderId) {
    event.preventDefault();

    const status = document.querySelector("#detailStatus").value;
    const note = document.querySelector("#adminNote").value;

    try {
        const result = await apiFetch(`/orders/${encodeURIComponent(orderId)}/status`, {
            method: "POST",
            body: JSON.stringify({ status, note }),
        });
        renderOrderDetail(result.order);
        await loadOrders();
    } catch {
        alert("Status konnte nicht gespeichert werden.");
    }
}

let searchTimer = null;
function scheduleLoadOrders() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadOrders, 250);
}

loginForm.addEventListener("submit", login);
logoutButton.addEventListener("click", logout);
refreshOrders.addEventListener("click", loadOrders);
ordersList.addEventListener("click", selectOrder);
searchInput.addEventListener("input", scheduleLoadOrders);
statusFilter.addEventListener("change", loadOrders);
viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
        state.activeView = tab.dataset.view;
        renderOrders();
    });
});

checkSession();
