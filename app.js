const SERVICE_FEE = 8.5;
const MULTI_MARKET_FEE = 2;
const MAX_ESTIMATED_ORDER_VALUE = 80;
const LOYALTY_TARGET_ORDERS = 8;
const ORDER_ENDPOINT = "/api/orders";
const LOYALTY_ENDPOINT = "/api/loyalty";
const COVERAGE_ENDPOINT = "/api/coverage";
const CAPACITY_ENDPOINT = "/api/capacity";
const CAPACITY_POLL_MS = 60000;
const SERVICE_AREA_LABEL = "ausgewählte Testbereiche von Rheydt-Odenkirchen";
const ORDER_STATUS_STORAGE_KEY = "shoppingOrderStatuses";
const ORDER_STATUS_POLL_MS = 15000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_COMPRESSION_QUALITY = 0.8;
const PHOTO_COMPRESSION_MIN_BYTES = 500 * 1024;
const DELIVERY_BLOCKS = [
    {
        cutoffHour: 10,
        cutoffMinute: 0,
        start: "12:00",
        end: "14:00",
    },
    {
        cutoffHour: 14,
        cutoffMinute: 0,
        start: "16:00",
        end: "18:00",
    },
];
const heavyItemKeywords = [
    "wasserkasten",
    "wasser kasten",
    "getränkekasten",
    "getraenkekasten",
    "getränkekiste",
    "getraenkekiste",
    "bierkasten",
    "limokasten",
    "cola kasten",
    "sprudel kasten",
    "kiste wasser",
    "kasten wasser",
];

const state = {
    items: [],
    photos: [],
    coverage: null,
    trackedOrders: [],
    currentOrderText: "",
    entryMode: "photo",
    capacity: null,
    editingOrder: null,
};

const itemForm = document.querySelector("#itemForm");
const customerForm = document.querySelector("#customerForm");
const loyaltyForm = document.querySelector("#loyaltyForm");
const loyaltyPhoneInput = document.querySelector("#loyaltyPhone");
const loyaltyAddressInput = document.querySelector("#loyaltyAddress");
const loyaltyAddressResult = document.querySelector("#loyaltyAddressResult");
const loyaltyResult = document.querySelector("#loyaltyResult");
const contrastToggle = document.querySelector("#contrastToggle");
const customerNameInput = document.querySelector("#customerName");
const customerPhoneInput = document.querySelector("#customerPhone");
const customerAddressInput = document.querySelector("#customerAddress");
const deliveryTimeInput = document.querySelector("#deliveryTime");
const checkAddressButton = document.querySelector("#checkAddress");
const addressCheckResult = document.querySelector("#addressCheckResult");
const entryModeInputs = document.querySelectorAll('input[name="entryMode"]');
const productEntryPanel = document.querySelector("#productEntryPanel");
const zettelPhotoPanel = document.querySelector("#zettelPhotoPanel");
const productRows = document.querySelector("#productRows");
const addProductRowButton = document.querySelector("#addProductRow");
const cameraInput = document.querySelector("#cameraInput");
const photoUploadInput = document.querySelector("#photoUploadInput");
const photoPreview = document.querySelector("#photoPreview");
const heavyWarning = document.querySelector("#heavyWarning");
const itemList = document.querySelector("#itemList");
const emptyState = document.querySelector("#emptyState");
const photoSummary = document.querySelector("#photoSummary");
const feeBox = document.querySelector("#feeBox");
const marketCount = document.querySelector("#marketCount");
const marketSurcharge = document.querySelector("#marketSurcharge");
const totalFee = document.querySelector("#totalFee");
const submitOrder = document.querySelector("#submitOrder");
const orderStatusSection = document.querySelector("#orderStatusSection");
const statusPanelToggle = document.querySelector("#statusPanelToggle");
const statusPanelSummary = document.querySelector("#statusPanelSummary");
const statusPanelCount = document.querySelector("#statusPanelCount");
const orderStatusList = document.querySelector("#orderStatusList");
const editOrderBanner = document.querySelector("#editOrderBanner");
const editOrderBannerText = document.querySelector("#editOrderBannerText");
const cancelEditOrderButton = document.querySelector("#cancelEditOrder");
const existingPhotosPanel = document.querySelector("#existingPhotosPanel");
const existingPhotosList = document.querySelector("#existingPhotosList");
const orderModal = document.querySelector("#orderModal");
const customerOrderSummary = document.querySelector("#customerOrderSummary");
const closeModal = document.querySelector("#closeModal");
const confirmOrder = document.querySelector("#confirmOrder");
const modalPhotoList = document.querySelector("#modalPhotoList");
const toast = document.querySelector("#toast");

const currencyFormatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
});

const orderStatusLabels = {
    new: "Eingegangen",
    deposit_pending: "Eingegangen",
    accepted: "Angenommen",
    shopping: "Beim Einkauf",
    delivered: "Geliefert",
    rejected: "Abgelehnt",
    cancelled: "Storniert",
};

function formatEuro(value) {
    return currencyFormatter.format(value);
}

function addDays(date, days) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

function isSameCalendarDay(firstDate, secondDate) {
    return firstDate.getFullYear() === secondDate.getFullYear()
        && firstDate.getMonth() === secondDate.getMonth()
        && firstDate.getDate() === secondDate.getDate();
}

function formatDeliveryDate(date, today) {
    if (isSameCalendarDay(date, today)) {
        return "Heute";
    }

    if (isSameCalendarDay(date, addDays(today, 1))) {
        return "Morgen";
    }

    return new Intl.DateTimeFormat("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
    }).format(date);
}

function deliveryCutoffFor(date, block) {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        block.cutoffHour,
        block.cutoffMinute,
    );
}

function deliveryBlockLabel(date, block, today) {
    const dayLabel = formatDeliveryDate(date, today);
    return `${dayLabel} ${block.start}–${block.end}`;
}

function deliveryBlockValue(date, block, today) {
    const dayLabel = formatDeliveryDate(date, today);
    const formattedDate = new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(date);
    return `${dayLabel}, ${formattedDate}, ${block.start}–${block.end}`;
}

function getDeliveryBlockOptions(now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const options = DELIVERY_BLOCKS
        .filter((block) => now < deliveryCutoffFor(today, block))
        .map((block) => ({
            label: deliveryBlockLabel(today, block, today),
            value: deliveryBlockValue(today, block, today),
        }));

    const tomorrow = addDays(today, 1);
    for (const block of DELIVERY_BLOCKS) {
        if (options.length >= DELIVERY_BLOCKS.length) {
            break;
        }

        options.push({
            label: deliveryBlockLabel(tomorrow, block, today),
            value: deliveryBlockValue(tomorrow, block, today),
        });
    }

    return options;
}

function blockKeyFromValue(value) {
    const match = String(value || "").match(/(\d{2})\.(\d{2})\.(\d{4}).*?(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
    if (!match) {
        return null;
    }

    const [, day, month, year, startHour, startMinute, endHour, endMinute] = match;
    return `${day}.${month}.${year} ${startHour.padStart(2, "0")}:${startMinute}-${endHour.padStart(2, "0")}:${endMinute}`;
}

function isBlockFull(value) {
    const capacity = state.capacity;
    if (!capacity || !capacity.maxOrdersPerBlock) {
        return false;
    }

    const key = blockKeyFromValue(value);
    if (!key) {
        return false;
    }

    return (capacity.usage?.[key] || 0) >= capacity.maxOrdersPerBlock;
}

function renderDeliveryTimeOptions() {
    if (state.editingOrder) {
        return;
    }

    const previousValue = deliveryTimeInput.value;
    const options = getDeliveryBlockOptions();
    const allFull = options.length > 0 && options.every((option) => isBlockFull(option.value));

    deliveryTimeInput.innerHTML = options.map((option) => {
        const full = isBlockFull(option.value);
        const label = full ? `${option.label} – leider ausgebucht` : option.label;
        return `<option value="${escapeHtml(option.value)}" ${full ? "disabled" : ""}>${escapeHtml(label)}</option>`;
    }).join("");

    if (allFull) {
        deliveryTimeInput.insertAdjacentHTML(
            "afterbegin",
            '<option value="" selected disabled>Alle Zeitfenster sind leider ausgebucht</option>',
        );
        return;
    }

    const previousOption = [...deliveryTimeInput.options]
        .find((option) => option.value === previousValue && !option.disabled);
    if (previousOption) {
        deliveryTimeInput.value = previousValue;
    } else {
        const firstFree = [...deliveryTimeInput.options].find((option) => !option.disabled);
        if (firstFree) {
            deliveryTimeInput.value = firstFree.value;
        }
    }
}

async function refreshCapacity() {
    try {
        const response = await fetch(CAPACITY_ENDPOINT);
        const result = await response.json();
        if (response.ok && result.ok) {
            state.capacity = result;
            renderDeliveryTimeOptions();
        }
    } catch {
        // Ohne Kapazitätsdaten bleiben alle Zeitfenster wählbar; der Server prüft beim Absenden.
    }
}

function createEmptyProduct() {
    return {
        id: createId(),
        name: "",
        quantity: "",
        supermarket: "Egal",
        preference: "specific",
        details: "",
        photos: [],
    };
}

function isPhotoEntryMode() {
    return state.entryMode === "photo";
}

function setEntryMode(mode) {
    state.entryMode = mode === "products" ? "products" : "photo";
    productEntryPanel.hidden = isPhotoEntryMode();
    zettelPhotoPanel.hidden = !isPhotoEntryMode();
    heavyWarning.hidden = isPhotoEntryMode() ? true : heavyWarning.hidden;
    renderSummary();
}

function getFilledItems() {
    if (isPhotoEntryMode()) {
        return [];
    }

    return state.items.filter((item) => (
        item.name.trim()
        || item.quantity.trim()
        || item.details.trim()
        || item.photos.length > 0
    ));
}

function getAllPhotos() {
    if (isPhotoEntryMode()) {
        return state.photos;
    }

    return getFilledItems().flatMap((item) => item.photos);
}

function getShoppingListText() {
    const items = getFilledItems();

    if (items.length === 0) {
        return "";
    }

    return items.map((item, index) => {
        const quantity = item.quantity.trim() || "Menge nicht angegeben";
        const supermarket = item.supermarket && item.supermarket !== "Egal" ? ` | ${item.supermarket}` : " | Supermarkt egal";
        const preference = item.preference === "cheapest" ? " | günstigste passende Variante" : " | bestimmter Artikel / Foto beachten";
        const details = item.details.trim() ? ` | Hinweis: ${item.details.trim()}` : "";
        const photos = item.photos.length ? ` | ${item.photos.length} Foto${item.photos.length === 1 ? "" : "s"}` : "";

        return `${index + 1}. ${quantity} ${item.name.trim() || "Produkt per Foto"}${supermarket}${preference}${details}${photos}`;
    }).join("\n");
}

function normalizeText(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ä/g, "a")
        .replace(/ö/g, "o")
        .replace(/ü/g, "u")
        .replace(/ß/g, "ss");
}

function isHeavyItem(value) {
    const normalizedValue = normalizeText(value);
    return heavyItemKeywords.some((keyword) => normalizedValue.includes(normalizeText(keyword)));
}

function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMarketStats() {
    const markets = new Set(getFilledItems()
        .map((item) => item.supermarket)
        .filter((supermarket) => supermarket && supermarket !== "Egal"));
    const count = markets.size;
    const surcharge = count >= 2 ? count * MULTI_MARKET_FEE : 0;
    const total = hasOrderContent() ? SERVICE_FEE + surcharge : 0;

    return { count, surcharge, total };
}

function keptExistingPhotos() {
    return state.editingOrder
        ? state.editingOrder.existingPhotos.filter((photo) => photo.keep)
        : [];
}

function hasOrderContent() {
    const hasNewContent = isPhotoEntryMode() ? state.photos.length > 0 : getFilledItems().length > 0;
    return hasNewContent || keptExistingPhotos().length > 0;
}

function submitButtonLabel() {
    return state.editingOrder ? "Änderungen speichern" : "Bestellung absenden";
}

function showToast(message, duration = 2800) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

function showAddressResult(message, type = "success") {
    addressCheckResult.hidden = false;
    addressCheckResult.textContent = message;
    addressCheckResult.classList.remove("success", "error");
    addressCheckResult.classList.add(type);
}

function showLoyaltyAddressResult(message, type = "success") {
    loyaltyAddressResult.hidden = false;
    loyaltyAddressResult.textContent = message;
    loyaltyAddressResult.classList.remove("success", "error");
    loyaltyAddressResult.classList.add(type);
}

function normalizeAddressText(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/,+/g, ",");
}

function updatePreferenceUi() {
    renderItems();
    renderFees();
}

function setContrastMode(enabled) {
    document.body.classList.toggle("dark-mode", enabled);
    contrastToggle.setAttribute("aria-pressed", String(enabled));
    contrastToggle.textContent = enabled ? "Heller Modus" : "Dunkelmodus";
    localStorage.setItem("darkMode", enabled ? "true" : "false");
    localStorage.removeItem("contrastMode");
}

function renderLoyaltyResult(loyalty) {
    const target = loyalty.targetOrders || LOYALTY_TARGET_ORDERS;
    const stampCount = Math.min(loyalty.stampCount || 0, target);
    const progressPercent = Math.round((stampCount / target) * 100);
    const freeShipText = loyalty.freeShipAvailable
        ? `Sie haben ${loyalty.availableFreeShipCount} kostenlose Lieferung${loyalty.availableFreeShipCount === 1 ? "" : "en"} verfügbar.`
        : `Noch ${loyalty.ordersUntilReward} Bestellung${loyalty.ordersUntilReward === 1 ? "" : "en"} bis zur kostenlosen Lieferung.`;

    loyaltyResult.hidden = false;
    loyaltyResult.innerHTML = `
        <h4>Ihre Treuepunkte</h4>
        <p><strong>${stampCount} von ${target} Punkten</strong></p>
        <div class="loyalty-progress" aria-label="${stampCount} von ${target} Punkten">
            <span style="width: ${progressPercent}%"></span>
        </div>
        <p>${escapeHtml(freeShipText)}</p>
        <p>Erfolgreich gespeicherte Bestellungen: ${loyalty.successfulOrderCount || 0}</p>
        <p>Bereits genutzte kostenlose Lieferungen: ${loyalty.freeShippingUsedCount || 0}</p>
    `;
}

function formatOrderDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "gerade eben";
    }

    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatRemainingDuration(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(safeSeconds / 86400);
    const hours = Math.floor((safeSeconds % 86400) / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);

    if (days > 0) {
        return `${days} Tag${days === 1 ? "" : "e"} ${hours} Std.`;
    }

    if (hours > 0) {
        return `${hours} Std. ${minutes} Min.`;
    }

    return `${Math.max(1, minutes)} Min.`;
}

function saveTrackedOrders() {
    localStorage.setItem(ORDER_STATUS_STORAGE_KEY, JSON.stringify(state.trackedOrders));
}

function loadTrackedOrders() {
    try {
        const savedOrders = JSON.parse(localStorage.getItem(ORDER_STATUS_STORAGE_KEY) || "[]");
        state.trackedOrders = Array.isArray(savedOrders) ? savedOrders.filter((order) => order.orderId) : [];
    } catch {
        state.trackedOrders = [];
    }
}

function isMobileStatusPanel() {
    return window.matchMedia("(max-width: 680px)").matches;
}

function setStatusPanelOpen(open) {
    orderStatusSection.classList.toggle("is-open", open);
    orderStatusSection.classList.toggle("is-collapsed", !open);
    statusPanelToggle.setAttribute("aria-expanded", String(open));
    statusPanelToggle.setAttribute("aria-label", open ? "Bestellungen schließen" : "Bestellungen ansehen");
}

function updateStatusPanelToggle() {
    const count = state.trackedOrders.length;
    const latestOrder = state.trackedOrders[0];
    const latestStatus = latestOrder?.status || "new";
    const latestStatusLabel = orderStatusLabels[latestStatus] || latestStatus;

    statusPanelCount.textContent = String(count);
    orderStatusSection.classList.toggle("has-cancelled-alert", state.trackedOrders.some((order) => order.status === "cancelled"));

    if (count === 0) {
        statusPanelSummary.textContent = "Antippen zum Öffnen";
        return;
    }

    if (count > 1) {
        statusPanelSummary.textContent = `${latestStatusLabel} · ${count} Bestellungen`;
        return;
    }

    statusPanelSummary.textContent = `${latestStatusLabel} · antippen für Details`;
}

function upsertTrackedOrder(orderStatus) {
    if (!orderStatus?.orderId) {
        return;
    }

    state.trackedOrders = [
        orderStatus,
        ...state.trackedOrders.filter((order) => order.orderId !== orderStatus.orderId),
    ].slice(0, 10);
    saveTrackedOrders();
    renderOrderStatuses();
}

function renderOrderStatuses() {
    orderStatusSection.hidden = state.trackedOrders.length === 0;
    updateStatusPanelToggle();

    if (state.trackedOrders.length === 0) {
        orderStatusList.innerHTML = "";
        setStatusPanelOpen(false);
        return;
    }

    orderStatusList.innerHTML = state.trackedOrders.map((order) => {
        const status = order.status || "new";
        const statusLabel = orderStatusLabels[status] || status;
        const canCancel = Boolean(order.canCancel);
        const canModify = Boolean(order.canModify);
        const infoLines = [];

        if (status === "cancelled") {
            infoLines.push("Diese Bestellung wurde storniert.");
        } else {
            if (canModify) {
                const modifyRest = order.modifyRemainingSeconds != null
                    ? ` (noch ${formatRemainingDuration(order.modifyRemainingSeconds)})`
                    : "";
                infoLines.push(`Sie können diese Bestellung noch ändern, z. B. Produkte hinzufügen oder entfernen${modifyRest}.`);
            }

            if (canCancel) {
                const cancelRest = order.cancelRemainingSeconds != null
                    ? ` (noch ${formatRemainingDuration(order.cancelRemainingSeconds)})`
                    : "";
                infoLines.push(`Stornieren ist bis 30 Minuten vor Beginn des Lieferzeitfensters möglich${cancelRest}.`);
            } else {
                infoLines.push("Stornieren ist nicht mehr möglich, weil das Lieferzeitfenster bald beginnt oder die Bestellung bereits in Bearbeitung ist.");
            }
        }

        return `
            <article class="order-status-card ${escapeHtml(status)}">
                <div class="order-status-top">
                    <div>
                        <h3>Bestellung vom ${formatOrderDate(order.createdAt)}</h3>
                        <p>Bestellnummer: ${escapeHtml(order.orderId)}</p>
                        ${order.deliveryTime ? `<p>Lieferung: ${escapeHtml(order.deliveryTime)}</p>` : ""}
                    </div>
                    <span class="order-status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                </div>
                ${infoLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
                ${order.cancelReason ? `<p>${escapeHtml(order.cancelReason)}</p>` : ""}
                <div class="order-status-actions">
                    ${canModify ? `<button class="modify-order-button" type="button" data-id="${escapeHtml(order.orderId)}">Bestellung ändern</button>` : ""}
                    ${canCancel ? `<button class="cancel-order-button" type="button" data-id="${escapeHtml(order.orderId)}">Bestellung stornieren</button>` : ""}
                    <button class="remove-status-button" type="button" data-id="${escapeHtml(order.orderId)}">Aus Liste entfernen</button>
                </div>
            </article>
        `;
    }).join("");
}

async function fetchOrderStatus(orderId) {
    const response = await fetch(`${ORDER_ENDPOINT}/${encodeURIComponent(orderId)}/status`);
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        throw new Error(result.error || "order_status_failed");
    }

    return result.order;
}

async function refreshTrackedOrders() {
    if (state.trackedOrders.length === 0) {
        return;
    }

    const refreshedOrders = await Promise.all(state.trackedOrders.map(async (order) => {
        try {
            return await fetchOrderStatus(order.orderId);
        } catch {
            return order;
        }
    }));

    state.trackedOrders = refreshedOrders;
    saveTrackedOrders();
    renderOrderStatuses();
}

async function cancelTrackedOrder(orderId) {
    const response = await fetch(`${ORDER_ENDPOINT}/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        if (result.order) {
            upsertTrackedOrder(result.order);
        }
        throw new Error(result.error || "cancel_failed");
    }

    upsertTrackedOrder(result.order);
    showToast("Bestellung wurde storniert.", 4200);
}

function removeTrackedOrder(orderId) {
    state.trackedOrders = state.trackedOrders.filter((order) => order.orderId !== orderId);
    saveTrackedOrders();
    renderOrderStatuses();
}

async function fetchOrderDetail(orderId) {
    const response = await fetch(`${ORDER_ENDPOINT}/${encodeURIComponent(orderId)}`);
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        throw new Error(result.error || "order_detail_failed");
    }

    return result.order;
}

function renderExistingPhotos() {
    const photos = state.editingOrder ? state.editingOrder.existingPhotos : [];
    existingPhotosPanel.hidden = photos.length === 0;

    existingPhotosList.innerHTML = photos.map((photo) => `
        <article class="photo-card ${photo.keep ? "" : "is-removed"}">
            <img src="${escapeHtml(photo.url)}" alt="Bisheriges Foto ${escapeHtml(photo.filename)}">
            <span class="photo-card-name">${escapeHtml(photo.filename)}${photo.keep ? "" : " – wird entfernt"}</span>
            <button class="toggle-existing-photo ${photo.keep ? "remove-photo" : "keep-photo"}" type="button" data-filename="${escapeHtml(photo.filename)}">
                ${photo.keep ? "Foto entfernen" : "Foto behalten"}
            </button>
        </article>
    `).join("");
}

function updateEditModeUi() {
    const editing = Boolean(state.editingOrder);
    editOrderBanner.hidden = !editing;
    editOrderBannerText.textContent = editing
        ? `Bestellung ${state.editingOrder.orderId} · Lieferung: ${state.editingOrder.deliveryTime || "wie vereinbart"}. Name, Telefon, Adresse und Zeitfenster bleiben unverändert.`
        : "";
    submitOrder.textContent = submitButtonLabel();
    deliveryTimeInput.disabled = editing;
    customerNameInput.readOnly = editing;
    customerPhoneInput.readOnly = editing;
    customerAddressInput.readOnly = editing;
    checkAddressButton.disabled = editing;
    renderExistingPhotos();
}

async function startOrderModification(orderId) {
    let order;
    try {
        order = await fetchOrderDetail(orderId);
    } catch {
        showToast("Bestellung konnte nicht geladen werden. Bitte versuchen Sie es erneut.", 4200);
        return;
    }

    if (order.status) {
        upsertTrackedOrder(order.status);
    }

    if (!order.status?.canModify) {
        showToast("Diese Bestellung kann nicht mehr geändert werden.", 4200);
        return;
    }

    resetProductRows();
    clearPhotos();

    const customer = order.customer || {};
    customerNameInput.value = customer.name || "";
    customerPhoneInput.value = customer.phone || "";
    customerAddressInput.value = customer.address || "";
    document.querySelector("#contactWay").value = customer.contactWay || "Telefon";
    document.querySelector("#deliveryNote").value = customer.deliveryNote === "keine Hinweise" ? "" : (customer.deliveryNote || "");
    state.coverage = null;
    addressCheckResult.hidden = true;

    const deliveryValue = customer.deliveryTime || "";
    deliveryTimeInput.innerHTML = `<option value="${escapeHtml(deliveryValue)}" selected>${escapeHtml(deliveryValue)}</option>`;
    deliveryTimeInput.value = deliveryValue;

    const items = Array.isArray(order.items) ? order.items : [];
    state.items = items.map((item) => ({
        id: createId(),
        name: item.name || "",
        quantity: item.quantity || "",
        supermarket: item.supermarket || "Egal",
        preference: item.preference === "cheapest" ? "cheapest" : "specific",
        details: item.details || "",
        photos: [],
    }));
    if (state.items.length === 0) {
        state.items.push(createEmptyProduct());
    }

    state.editingOrder = {
        orderId: order.orderId,
        deliveryTime: deliveryValue,
        existingPhotos: (order.photos || []).map((photo) => ({
            filename: photo.filename,
            url: photo.url,
            keep: true,
        })),
    };

    const mode = order.entryMode === "products" || items.length > 0 ? "products" : "photo";
    const modeRadio = document.querySelector(`input[name="entryMode"][value="${mode}"]`);
    if (modeRadio) {
        modeRadio.checked = true;
    }
    setEntryMode(mode);
    updateHeavyWarning();
    render();
    updateEditModeUi();
    setStatusPanelOpen(false);
    document.querySelector("#bestellen")?.scrollIntoView({ behavior: "smooth" });
    showToast("Ihre Bestellung wurde zum Ändern geladen. Sie können Produkte und Fotos anpassen.", 5200);
}

function stopOrderModification() {
    state.editingOrder = null;
    resetProductRows();
    clearPhotos();
    itemForm.reset();
    customerForm.reset();
    state.coverage = null;
    addressCheckResult.hidden = true;
    const photoRadio = document.querySelector('input[name="entryMode"][value="photo"]');
    if (photoRadio) {
        photoRadio.checked = true;
    }
    setEntryMode("photo");
    renderDeliveryTimeOptions();
    render();
    updateEditModeUi();
}

async function submitModificationToServer() {
    const formData = new FormData();
    formData.append("orderText", state.currentOrderText);
    formData.append("payload", JSON.stringify(buildOrderPayload()));
    formData.append("keepPhotos", JSON.stringify(keptExistingPhotos().map((photo) => photo.filename)));

    getFilledItems().forEach((item) => {
        item.photos.forEach((photo) => {
            formData.append("photos", photo.file, `${photo.uploadPrefix}-${photo.name}`);
        });
    });

    if (isPhotoEntryMode()) {
        state.photos.forEach((photo) => {
            formData.append("photos", photo.file, `${photo.uploadPrefix}-${photo.name}`);
        });
    }

    const response = await fetch(`${ORDER_ENDPOINT}/${encodeURIComponent(state.editingOrder.orderId)}/modify`, {
        method: "POST",
        body: formData,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        if (response.status === 413) {
            throw new Error("too_large");
        }
        if (result.order) {
            upsertTrackedOrder(result.order);
        }
        throw new Error(result.error || "modify_failed");
    }

    return result;
}

function buildLoyaltySuccessMessage(result) {
    if (!result.loyalty) {
        return `Bestellung wurde gesendet. Nummer: ${result.orderId}`;
    }

    if (result.freeShippingUsedOnThisOrder) {
        return `Bestellung wurde gesendet. Kostenlose Lieferung wurde für diese Bestellung genutzt. Nummer: ${result.orderId}`;
    }

    if (result.loyalty.freeShipAvailable) {
        return `Bestellung wurde gesendet. Sie haben jetzt 1 kostenlose Lieferung verfügbar. Nummer: ${result.orderId}`;
    }

    return `Bestellung wurde gesendet. Treuepunkte: ${result.loyalty.stampCount}/${result.loyalty.targetOrders}. Nummer: ${result.orderId}`;
}

async function checkServiceArea(address) {
    const query = new URLSearchParams({ address });
    const response = await fetch(`${COVERAGE_ENDPOINT}?${query.toString()}`);
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        throw new Error(result.error || result.coverage?.error || "coverage_failed");
    }

    return result.coverage;
}

async function checkAddressSupport() {
    if (!customerAddressInput.reportValidity()) {
        showAddressResult("Bitte geben Sie zuerst Ihre vollständige Adresse ein.", "error");
        return null;
    }

    if (!/\d/.test(customerAddressInput.value)) {
        showAddressResult("Bitte geben Sie Straße und Hausnummer vollständig ein.", "error");
        return null;
    }

    checkAddressButton.disabled = true;
    checkAddressButton.textContent = "Prüfe ...";
    showAddressResult("Adresse wird geprüft ...", "success");

    try {
        const originalAddress = customerAddressInput.value.trim();
        const coverage = await checkServiceArea(customerAddressInput.value.trim());
        state.coverage = coverage;
        const suggestedAddress = coverage.suggestedAddress || coverage.resolvedAddress;
        const correctedAddress = suggestedAddress && normalizeAddressText(suggestedAddress) !== normalizeAddressText(originalAddress);

        if (suggestedAddress) {
            customerAddressInput.value = suggestedAddress;
        }

        if (coverage.withinServiceArea) {
            const prefix = correctedAddress ? "Adresse wurde automatisch korrigiert" : "Adresse gefunden";
            showAddressResult(`${prefix}: ${suggestedAddress || "Ihre Adresse"}. Diese Adresse wird aktuell unterstützt.`, "success");
        } else {
            const addressText = suggestedAddress ? ` Gefundene Adresse: ${suggestedAddress}.` : "";
            showAddressResult(`Diese Adresse liegt leider noch außerhalb unseres aktuellen Test-Liefergebiets.${addressText}`, "error");
        }

        return coverage;
    } catch {
        state.coverage = null;
        showAddressResult("Adresse konnte nicht geprüft werden. Bitte prüfen Sie Straße, Hausnummer, PLZ und Ort.", "error");
        return null;
    } finally {
        checkAddressButton.disabled = false;
        checkAddressButton.textContent = "Adresse prüfen";
    }
}

function renderProductRows() {
    productRows.innerHTML = state.items.map((item, index) => {
        const canRemove = state.items.length > 1;
        const photoInputId = `productPhoto-${item.id}`;
        const photoPreviewHtml = item.photos.length
            ? `<div class="product-photo-thumbs">
                ${item.photos.map((photo) => `
                    <div class="product-photo-thumb">
                        <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}">
                        <button type="button" class="remove-product-photo" data-item-id="${item.id}" data-photo-id="${photo.id}" aria-label="Foto entfernen">×</button>
                    </div>
                `).join("")}
            </div>`
            : `<p>Noch kein Foto zu diesem Produkt.</p>`;

        return `
            <article class="product-row" data-id="${item.id}">
                <div class="product-row-head">
                    <strong>Produkt ${index + 1}</strong>
                    ${canRemove ? `<button class="remove-product-row" type="button" data-id="${item.id}" aria-label="Produkt ${index + 1} entfernen">Entfernen</button>` : ""}
                </div>

                <div class="product-fields">
                    <label class="field">
                        <span>Produkt</span>
                        <input type="text" data-id="${item.id}" data-field="name" value="${escapeHtml(item.name)}" placeholder="z. B. Milch, Brot, Kaffee">
                    </label>
                    <label class="field">
                        <span>Menge</span>
                        <input type="text" data-id="${item.id}" data-field="quantity" value="${escapeHtml(item.quantity)}" placeholder="z. B. 2x, 1 Packung">
                    </label>
                    <label class="field">
                        <span>Supermarkt</span>
                        <select data-id="${item.id}" data-field="supermarket">
                            ${["Egal", "Netto", "dm", "Lidl", "Aldi"].map((market) => `
                                <option value="${market}" ${item.supermarket === market ? "selected" : ""}>${market}</option>
                            `).join("")}
                        </select>
                    </label>
                    <label class="field">
                        <span>Wunsch</span>
                        <select data-id="${item.id}" data-field="preference">
                            <option value="specific" ${item.preference === "specific" ? "selected" : ""}>Genau diesen Artikel</option>
                            <option value="cheapest" ${item.preference === "cheapest" ? "selected" : ""}>Günstigste passende Variante</option>
                        </select>
                    </label>
                </div>

                <label class="field product-note-field">
                    <span>Hinweis</span>
                    <input type="text" data-id="${item.id}" data-field="details" value="${escapeHtml(item.details)}" placeholder="z. B. Marke, Bio, laktosefrei, Angebot vom Foto">
                </label>

                <div class="product-photo-area">
                    <button class="product-photo-button open-product-photo-choice" type="button" data-id="${item.id}" aria-expanded="false">
                        📷 Foto aufnehmen oder Bild auswählen
                    </button>
                    <div class="product-photo-choice-menu" data-id="${item.id}" hidden>
                        <label class="product-photo-choice-option" for="${photoInputId}-camera">📸 Jetzt fotografieren</label>
                        <label class="product-photo-choice-option secondary" for="${photoInputId}-gallery">🖼️ Bild auswählen</label>
                    </div>
                    <input class="visually-hidden product-photo-input" id="${photoInputId}-camera" type="file" accept="image/*" capture="environment" multiple data-id="${item.id}">
                    <input class="visually-hidden product-photo-input" id="${photoInputId}-gallery" type="file" accept="image/*" multiple data-id="${item.id}">
                    ${photoPreviewHtml}
                </div>
            </article>
        `;
    }).join("");
}

function renderItems() {
    const filledItems = getFilledItems();
    emptyState.hidden = hasOrderContent();

    itemList.innerHTML = filledItems
        .map((item, index) => {
            const preferenceText = item.preference === "cheapest" ? "Günstigste passende Variante" : "Genau diesen Artikel";
            const preferenceClass = item.preference === "cheapest" ? " cheapest" : "";
            const details = item.details ? `<p class="item-details">${escapeHtml(item.details)}</p>` : "";
            const photoBadge = item.photos.length
                ? `<span class="badge">${item.photos.length} Foto${item.photos.length === 1 ? "" : "s"}</span>`
                : "";

            return `
                <article class="cart-item">
                    <div>
                        <h4>${index + 1}. ${escapeHtml(item.name || "Produkt per Foto")}</h4>
                        <div class="item-meta">
                            <span class="badge">${escapeHtml(item.quantity || "Menge offen")}</span>
                            <span class="badge">${escapeHtml(item.supermarket || "Egal")}</span>
                            <span class="badge${preferenceClass}">${preferenceText}</span>
                            ${photoBadge}
                        </div>
                        ${details}
                    </div>
                    <button class="remove-item" type="button" data-id="${item.id}" aria-label="${escapeHtml(item.name || "Produkt")} entfernen">×</button>
                </article>
            `;
        })
        .join("");
}

function renderPhotos() {
    if (!isPhotoEntryMode()) {
        photoSummary.hidden = true;
        photoSummary.textContent = "";
        return;
    }

    if (state.photos.length === 0) {
        photoPreview.innerHTML = "<p>Noch kein Foto vom Einkaufszettel ausgewählt.</p>";
        photoSummary.hidden = true;
        photoSummary.textContent = "";
        return;
    }

    photoPreview.innerHTML = `
        <div class="photo-grid">
            ${state.photos.map((photo) => `
                <article class="photo-card">
                    <img src="${escapeHtml(photo.url)}" alt="Vorschau von ${escapeHtml(photo.name)}">
                    <span class="photo-card-name">${escapeHtml(photo.name)}</span>
                    <button class="remove-photo" type="button" data-id="${photo.id}">Foto entfernen</button>
                </article>
            `).join("")}
        </div>
    `;

    photoSummary.hidden = false;
    photoSummary.textContent = `${state.photos.length} Foto${state.photos.length === 1 ? "" : "s"} vom Einkaufszettel hinzugefügt.`;
}

function renderModalPhotos() {
    const keptPhotos = keptExistingPhotos().map((photo) => ({ url: photo.url, name: `${photo.filename} (bereits hochgeladen)` }));
    const photos = [...keptPhotos, ...getAllPhotos()];

    if (photos.length === 0) {
        modalPhotoList.hidden = true;
        modalPhotoList.innerHTML = "";
        return;
    }

    modalPhotoList.hidden = false;
    modalPhotoList.innerHTML = `
        <h3>Fotos zu Ihrer Bestellung</h3>
        <div class="modal-photo-grid">
            ${photos.map((photo) => `
                <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}">
            `).join("")}
        </div>
    `;
}

function getPreferenceLabel(preference) {
    return preference === "cheapest" ? "Bitte die günstigste Option kaufen" : "Bitte genau diesen Artikel kaufen";
}

function renderCustomerOrderSummary() {
    const customer = getCustomerData();
    const filledItems = getFilledItems();
    const itemCards = filledItems.map((item, index) => {
        const details = item.details
            ? `<p class="summary-item-note">${escapeHtml(item.details)}</p>`
            : "";
        const photoText = item.photos.length
            ? `<span>${item.photos.length} Foto${item.photos.length === 1 ? "" : "s"} zu diesem Produkt</span>`
            : "";

        return `
            <li class="summary-item-card">
                <span class="summary-item-number">${index + 1}</span>
                <div class="summary-item-content">
                    <strong>${escapeHtml(item.name || "Produkt per Foto")}</strong>
                    <div class="summary-item-badges">
                        <span>${escapeHtml(item.quantity || "Menge offen")}</span>
                        <span>${escapeHtml(item.supermarket || "Egal")}</span>
                        <span>${getPreferenceLabel(item.preference)}</span>
                        ${photoText}
                    </div>
                    ${details}
                </div>
            </li>
        `;
    }).join("");

    const photoInfo = isPhotoEntryMode() && state.photos.length
        ? `
            <div class="summary-photo-note">
                <span aria-hidden="true">📷</span>
                <div>
                    <strong>${state.photos.length} Foto${state.photos.length === 1 ? "" : "s"} vom Einkaufszettel</strong>
                    <p>Bitte prüfen Sie die Foto-Vorschau unten.</p>
                </div>
            </div>
        `
        : "";

    const shoppingList = itemCards
        ? `<ol class="summary-item-list">${itemCards}</ol>${photoInfo}`
        : `${photoInfo}<p class="summary-empty-note">Ihre Einkaufsliste wurde als Foto hochgeladen.</p>`;

    customerOrderSummary.innerHTML = `
        <section class="summary-review-card" aria-label="Kundendaten prüfen">
            <h3><span aria-hidden="true">👤</span> Ihre Daten</h3>
            <dl class="summary-data-list">
                <div>
                    <dt>Name</dt>
                    <dd>${escapeHtml(customer.name)}</dd>
                </div>
                <div>
                    <dt>Telefon</dt>
                    <dd>${escapeHtml(customer.phone)}</dd>
                </div>
                <div>
                    <dt>Adresse</dt>
                    <dd>${escapeHtml(customer.address)}</dd>
                </div>
            </dl>
        </section>

        <section class="summary-review-card" aria-label="Einkaufsliste prüfen">
            <h3><span aria-hidden="true">🛒</span> Ihre Einkaufsliste</h3>
            ${shoppingList}
        </section>
    `;
}

function renderFees() {
    const stats = getMarketStats();

    feeBox.hidden = !hasOrderContent();
    marketCount.textContent = stats.count || (hasOrderContent() ? "nach Rückfrage" : "0");
    marketSurcharge.textContent = formatEuro(stats.surcharge);
    totalFee.textContent = formatEuro(stats.total);
    submitOrder.disabled = !hasOrderContent();
}

function render() {
    renderProductRows();
    renderItems();
    renderPhotos();
    renderFees();
}

function renderSummary() {
    renderItems();
    renderPhotos();
    renderFees();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
        };

        return entities[character];
    });
}

function updateHeavyWarning() {
    const combinedText = getFilledItems()
        .map((item) => `${item.name} ${item.details}`)
        .join(" ");
    heavyWarning.hidden = !isHeavyItem(combinedText);
}

function addProductRow(focusNewRow = true) {
    const newItem = createEmptyProduct();
    state.items.push(newItem);
    render();

    if (focusNewRow) {
        const input = productRows.querySelector(`[data-id="${newItem.id}"][data-field="name"]`);
        input?.focus();
    }
}

function updateProductField(target) {
    const item = state.items.find((currentItem) => currentItem.id === target.dataset.id);
    if (!item) {
        return;
    }

    item[target.dataset.field] = target.value;
    updateHeavyWarning();
    renderSummary();
}

function removeProductRow(itemId) {
    const item = state.items.find((currentItem) => currentItem.id === itemId);
    if (item) {
        item.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    }

    state.items = state.items.filter((currentItem) => currentItem.id !== itemId);
    if (state.items.length === 0) {
        state.items.push(createEmptyProduct());
    }
    updateHeavyWarning();
    render();
    showToast("Produkt wurde entfernt.");
}

function removeItem(event) {
    const removeButton = event.target.closest(".remove-item");

    if (!removeButton) {
        return;
    }

    removeProductRow(removeButton.dataset.id);
}

async function loadImageSource(file) {
    if (typeof createImageBitmap === "function") {
        return createImageBitmap(file);
    }

    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("image_decode_failed"));
        };
        image.src = url;
    });
}

async function compressPhotoFile(file) {
    if (!file.type.startsWith("image/") || file.size <= PHOTO_COMPRESSION_MIN_BYTES) {
        return file;
    }

    try {
        const source = await loadImageSource(file);
        const width = source.width || source.naturalWidth;
        const height = source.height || source.naturalHeight;
        const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(width, height));

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);

        if (typeof source.close === "function") {
            source.close();
        }

        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, "image/jpeg", PHOTO_COMPRESSION_QUALITY);
        });

        if (!blob || blob.size >= file.size) {
            return file;
        }

        const baseName = (file.name || "foto").replace(/\.[^.]+$/, "");
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    } catch {
        return file;
    }
}

function compressPhotoFiles(files) {
    return Promise.all(files.map((file) => compressPhotoFile(file)));
}

function totalUploadBytes() {
    return getAllPhotos().reduce((total, photo) => total + (photo.size || 0), 0);
}

async function handleProductPhotoFiles(event) {
    const input = event.target.closest(".product-photo-input");
    if (!input) {
        return;
    }

    const item = state.items.find((currentItem) => currentItem.id === input.dataset.id);
    const selectedFiles = Array.from(input.files || []).filter((file) => file.type.startsWith("image/"));

    if (!item || selectedFiles.length === 0) {
        showToast("Bitte wählen Sie ein Foto aus.");
        return;
    }

    const files = await compressPhotoFiles(selectedFiles);

    const newPhotos = files.map((file) => {
        const id = createId();
        return {
            id,
            uploadPrefix: `produkt-${item.id}-${id}`,
            itemId: item.id,
            name: file.name || "Produkt-Foto",
            size: file.size,
            type: file.type,
            file,
            url: URL.createObjectURL(file),
        };
    });

    item.photos.push(...newPhotos);
    input.value = "";
    render();
    showToast(`${newPhotos.length} Foto${newPhotos.length === 1 ? "" : "s"} zu diesem Produkt hinzugefügt.`);
}

function removeProductPhoto(itemId, photoId) {
    const item = state.items.find((currentItem) => currentItem.id === itemId);
    if (!item) {
        return;
    }

    const photo = item.photos.find((currentPhoto) => currentPhoto.id === photoId);
    if (photo) {
        URL.revokeObjectURL(photo.url);
    }

    item.photos = item.photos.filter((currentPhoto) => currentPhoto.id !== photoId);
    render();
    showToast("Foto wurde entfernt.");
}

async function handlePhotoFiles(event) {
    const selectedFiles = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));

    if (selectedFiles.length === 0) {
        showToast("Bitte wählen Sie ein Foto aus.");
        return;
    }

    const files = await compressPhotoFiles(selectedFiles);

    const newPhotos = files.map((file) => {
        const id = createId();
        return {
            id,
            uploadPrefix: `zusatz-${id}`,
            name: file.name || "Einkaufszettel-Foto",
            size: file.size,
            type: file.type,
            file,
            url: URL.createObjectURL(file),
        };
    });

    state.photos.push(...newPhotos);
    event.target.value = "";
    render();
    showToast(`${newPhotos.length} Foto${newPhotos.length === 1 ? "" : "s"} hinzugefügt.`);
}

function removePhoto(event) {
    const removeButton = event.target.closest(".remove-photo");

    if (!removeButton) {
        return;
    }

    const photo = state.photos.find((currentPhoto) => currentPhoto.id === removeButton.dataset.id);

    if (photo) {
        URL.revokeObjectURL(photo.url);
    }

    state.photos = state.photos.filter((currentPhoto) => currentPhoto.id !== removeButton.dataset.id);
    render();
    showToast("Foto wurde entfernt.");
}

function clearPhotos() {
    state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    state.photos = [];
    cameraInput.value = "";
    photoUploadInput.value = "";
}

function resetProductRows() {
    state.items.forEach((item) => {
        item.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    });
    state.items = [createEmptyProduct()];
}

function getCustomerData() {
    return {
        name: customerNameInput.value.trim(),
        phone: customerPhoneInput.value.trim(),
        address: customerAddressInput.value.trim(),
        deliveryTime: deliveryTimeInput.value.trim() || "nicht angegeben",
        contactWay: document.querySelector("#contactWay").value,
        deliveryNote: document.querySelector("#deliveryNote").value.trim() || "keine Hinweise",
    };
}

function serializeItems() {
    return getFilledItems().map((item) => ({
        id: item.id,
        name: item.name.trim(),
        quantity: item.quantity.trim(),
        supermarket: item.supermarket || "Egal",
        preference: item.preference || "specific",
        details: item.details.trim(),
        photos: item.photos.map((photo) => ({
            id: photo.id,
            uploadPrefix: photo.uploadPrefix,
            name: photo.name,
            size: photo.size,
            type: photo.type,
        })),
    }));
}

function serializeExtraPhotos() {
    if (!isPhotoEntryMode()) {
        return [];
    }

    return state.photos.map((photo) => ({
        id: photo.id,
        uploadPrefix: photo.uploadPrefix,
        name: photo.name,
        size: photo.size,
        type: photo.type,
    }));
}

function buildOrderText() {
    const customer = getCustomerData();
    const stats = getMarketStats();
    const coverageText = state.coverage
        ? `${state.coverage.withinServiceArea ? "Adresse liegt im aktuellen Liefergebiet" : "Adresse liegt außerhalb des aktuellen Liefergebiets"}`
        : SERVICE_AREA_LABEL;
    const items = serializeItems();
    const groupedMarkets = [...new Set(items.map((item) => item.supermarket).filter((market) => market && market !== "Egal"))].join(", ");
    const marketText = groupedMarkets || "Supermarkt egal oder per Foto/Rückfrage klären";
    const itemLines = items.length
        ? items.map((item, index) => {
            const preferenceText = item.preference === "cheapest" ? "günstigste passende Variante" : "genau diesen Artikel / Foto beachten";
            const quantity = item.quantity || "Menge offen";
            const name = item.name || "Produkt per Foto";
            const details = item.details ? ` | Hinweis: ${item.details}` : "";
            const photos = item.photos.length ? ` | Fotos: ${item.photos.map((photo) => photo.name).join(", ")}` : " | keine Produktfotos";
            return `${index + 1}. ${quantity} ${name} | ${item.supermarket} | ${preferenceText}${details}${photos}`;
        }).join("\n")
        : "Keine Produkte als Zeile eingetragen. Bitte zusätzliche Fotos prüfen.";
    const keptPhotos = keptExistingPhotos();
    const allExtraPhotoNames = [
        ...keptPhotos.map((photo) => `${photo.filename} (bereits hochgeladen)`),
        ...state.photos.map((photo) => photo.name),
    ];
    const extraPhotoLines = allExtraPhotoNames.length
        ? allExtraPhotoNames.map((name, index) => `${index + 1}. ${name}`).join("\n")
        : "keine zusätzlichen Fotos";

    const surchargeRule = stats.count >= 2
        ? `${stats.count} Märkte × ${formatEuro(MULTI_MARKET_FEE)} = ${formatEuro(stats.surcharge)}`
        : "0,00 €";

    const heading = state.editingOrder
        ? `GEÄNDERTE EINKAUFSBESTELLUNG (${state.editingOrder.orderId})`
        : "NEUE EINKAUFSBESTELLUNG";

    return `${heading}

Kontaktdaten
Name: ${customer.name}
Telefon: ${customer.phone}
Kontaktweg: ${customer.contactWay}
Lieferadresse: ${customer.address}
Servicegebiet-Prüfung: ${coverageText}
Lieferzeitfenster: ${customer.deliveryTime}
Lieferhinweise: ${customer.deliveryNote}

Supermärkte
${marketText}

Produkte
${itemLines}

Zusätzliche Fotos vom Einkaufszettel oder Angebot
${extraPhotoLines}

Kostenhinweis
Kassenbon: Kundin/Kunde zahlt genau den Betrag laut Supermarkt-Kassenbon.
Einkaufsgebühr: ${formatEuro(SERVICE_FEE)}
Mehrmarkt-Zuschlag: ${surchargeRule}
Servicegebühr gesamt: ${formatEuro(stats.total)}

Treuepunkte
Jede erfolgreich gespeicherte Bestellung zählt als 1 Punkt.
Nach ${LOYALTY_TARGET_ORDERS} Bestellungen erhalten Kundinnen und Kunden 1 Bestellung mit kostenloser Lieferung.
Die kostenlose Lieferung wird automatisch berücksichtigt, wenn Adresse und Telefonnummer übereinstimmen.

Hinweis: Schwere Artikel wie Getränkekisten oder Wasserkästen werden aktuell nicht unterstützt.`;
}

function buildOrderPayload() {
    const stats = getMarketStats();
    const items = serializeItems();

    return {
        customer: getCustomerData(),
        entryMode: state.entryMode,
        shoppingListText: getShoppingListText(),
        cheapestPreference: items.length > 0 && items.every((item) => item.preference === "cheapest"),
        items,
        photos: serializeExtraPhotos(),
        coverage: state.coverage,
        deposit: {
            required: false,
            reason: "deposit_not_required",
        },
        fees: {
            receipt: "Kundin/Kunde zahlt genau den Kassenbonbetrag.",
            serviceFee: SERVICE_FEE,
            multiMarketFee: MULTI_MARKET_FEE,
            maxEstimatedOrderValue: MAX_ESTIMATED_ORDER_VALUE,
            marketCount: stats.count,
            surcharge: stats.surcharge,
            totalServiceFee: stats.total,
        },
        loyaltyProgram: {
            targetOrders: LOYALTY_TARGET_ORDERS,
            reward: `1 kostenlose Lieferung nach ${LOYALTY_TARGET_ORDERS} erfolgreich gespeicherten Bestellungen.`,
        },
    };
}

async function checkLoyaltyPoints(event) {
    event.preventDefault();

    if (!loyaltyForm.reportValidity()) {
        return;
    }

    const phone = loyaltyPhoneInput.value.trim();
    let address = loyaltyAddressInput.value.trim();

    loyaltyResult.hidden = false;
    loyaltyResult.innerHTML = "<p>Adresse und Treuepunkte werden geprüft ...</p>";
    showLoyaltyAddressResult("Adresse wird geprüft und bei Bedarf automatisch korrigiert ...", "success");

    try {
        try {
            const originalAddress = address;
            const coverage = await checkServiceArea(address);
            const suggestedAddress = coverage.suggestedAddress || coverage.resolvedAddress;
            const correctedAddress = suggestedAddress && normalizeAddressText(suggestedAddress) !== normalizeAddressText(originalAddress);

            if (suggestedAddress) {
                address = suggestedAddress;
                loyaltyAddressInput.value = suggestedAddress;
            }

            if (correctedAddress) {
                showLoyaltyAddressResult(`Adresse wurde automatisch korrigiert: ${suggestedAddress}`, "success");
            } else if (suggestedAddress) {
                showLoyaltyAddressResult(`Adresse gefunden: ${suggestedAddress}`, "success");
            } else {
                showLoyaltyAddressResult("Adresse wurde geprüft.", "success");
            }
        } catch {
            showLoyaltyAddressResult("Adresse konnte nicht automatisch korrigiert werden. Wir prüfen die Punkte mit Ihrer Eingabe.", "error");
        }

        const query = new URLSearchParams({ phone, address });
        const response = await fetch(`${LOYALTY_ENDPOINT}?${query.toString()}`);
        const result = await response.json();

        if (!response.ok || !result.ok) {
            throw new Error(result.error || "loyalty_lookup_failed");
        }

        renderLoyaltyResult(result.loyalty);
    } catch {
        loyaltyResult.innerHTML = "<p>Treuepunkte konnten nicht geprüft werden. Bitte versuchen Sie es später erneut.</p>";
    }
}

async function submitOrderToServer() {
    const formData = new FormData();
    formData.append("orderText", state.currentOrderText);
    formData.append("payload", JSON.stringify(buildOrderPayload()));

    getFilledItems().forEach((item) => {
        item.photos.forEach((photo) => {
            formData.append("photos", photo.file, `${photo.uploadPrefix}-${photo.name}`);
        });
    });

    if (isPhotoEntryMode()) {
        state.photos.forEach((photo) => {
            formData.append("photos", photo.file, `${photo.uploadPrefix}-${photo.name}`);
        });
    }

    const response = await fetch(ORDER_ENDPOINT, {
        method: "POST",
        body: formData,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
        if (response.status === 413) {
            throw new Error("too_large");
        }
        throw new Error(result.error || "upload_failed");
    }

    return result;
}

function uploadErrorMessage(error) {
    const code = error?.message || "";

    if (code === "too_large") {
        return "Die Fotos sind zusammen zu groß. Bitte entfernen Sie einige Fotos und versuchen Sie es erneut.";
    }

    if (code === "outside_service_area") {
        return "Diese Adresse liegt leider noch außerhalb unseres aktuellen Test-Liefergebiets.";
    }

    if (code === "address_not_found") {
        return "Ihre Adresse wurde nicht gefunden. Bitte prüfen Sie Straße, Hausnummer, PLZ und Ort.";
    }

    if (code === "block_full") {
        return "Dieses Lieferzeitfenster ist leider schon voll. Bitte wählen Sie ein anderes Zeitfenster.";
    }

    if (code === "modify_not_allowed") {
        return "Diese Bestellung kann nicht mehr geändert werden. Der Bestellschluss für das Zeitfenster ist vorbei oder der Einkauf läuft bereits.";
    }

    return "Senden nicht möglich. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.";
}

async function openOrderModal() {
    if (!hasOrderContent()) {
        showToast("Bitte fügen Sie mindestens ein Produkt oder ein Foto hinzu.");
        return;
    }

    if (totalUploadBytes() > MAX_UPLOAD_BYTES - 1024 * 1024) {
        showToast("Die Fotos sind zusammen zu groß. Bitte entfernen Sie einige Fotos.", 6200);
        return;
    }

    if (!customerForm.reportValidity()) {
        showToast("Bitte füllen Sie die Pflichtfelder bei den Kontaktdaten aus.");
        return;
    }

    // Beim Ändern bleibt die geprüfte Adresse fest, daher keine erneute Adressprüfung.
    if (!state.editingOrder) {
        submitOrder.disabled = true;
        submitOrder.textContent = "Adresse wird geprüft ...";

        const coverage = await checkAddressSupport();

        submitOrder.disabled = false;
        submitOrder.textContent = submitButtonLabel();

        if (!coverage) {
            return;
        }

        if (!coverage.withinServiceArea) {
            showToast("Diese Adresse liegt leider noch außerhalb unseres aktuellen Test-Liefergebiets in Rheydt-Odenkirchen.", 7200);
            return;
        }
    }

    state.currentOrderText = buildOrderText();
    renderCustomerOrderSummary();
    renderModalPhotos();
    confirmOrder.textContent = state.editingOrder ? "Änderung bestätigen" : "Bestellung bestätigen";
    orderModal.hidden = false;
    closeModal.focus();
}

function closeOrderModal() {
    orderModal.hidden = true;
}

async function finishOrderModification() {
    confirmOrder.disabled = true;
    confirmOrder.textContent = "Wird gespeichert ...";

    try {
        const result = await submitModificationToServer();
        closeOrderModal();
        if (result.orderStatus) {
            upsertTrackedOrder(result.orderStatus);
        }
        stopOrderModification();
        showToast(`Ihre Bestellung wurde geändert. Nummer: ${result.orderId}`, 6200);
    } catch (error) {
        showToast(uploadErrorMessage(error), 6200);
        if (error?.message === "modify_not_allowed") {
            closeOrderModal();
            stopOrderModification();
            refreshTrackedOrders();
        }
    } finally {
        confirmOrder.disabled = false;
        confirmOrder.textContent = state.editingOrder ? "Änderung bestätigen" : "Bestellung bestätigen";
    }
}

async function finishOrder() {
    if (state.editingOrder) {
        await finishOrderModification();
        return;
    }

    confirmOrder.disabled = true;
    confirmOrder.textContent = "Wird gesendet ...";

    try {
        const result = await submitOrderToServer();
        closeOrderModal();
        localStorage.setItem("lastShoppingOrder", state.currentOrderText);
        localStorage.setItem("lastShoppingOrderId", result.orderId);
        resetProductRows();
        state.coverage = null;
        clearPhotos();
        itemForm.reset();
        customerForm.reset();
        setEntryMode("photo");
        render();
        if (result.loyalty) {
            renderLoyaltyResult(result.loyalty);
        }
        if (result.orderStatus) {
            upsertTrackedOrder(result.orderStatus);
            if (isMobileStatusPanel()) {
                setStatusPanelOpen(false);
                statusPanelToggle.focus({ preventScroll: true });
            } else {
                orderStatusSection.focus({ preventScroll: true });
            }
        }
        refreshCapacity();
        showToast(buildLoyaltySuccessMessage(result), 6200);
    } catch (error) {
        showToast(uploadErrorMessage(error), 6200);
        if (error?.message === "block_full") {
            closeOrderModal();
            refreshCapacity();
        }
    } finally {
        confirmOrder.disabled = false;
        confirmOrder.textContent = "Bestellung bestätigen";
    }
}

contrastToggle.addEventListener("click", () => {
    setContrastMode(!document.body.classList.contains("dark-mode"));
});

statusPanelToggle.addEventListener("click", () => {
    setStatusPanelOpen(!orderStatusSection.classList.contains("is-open"));
});

customerAddressInput.addEventListener("input", () => {
    state.coverage = null;
    addressCheckResult.hidden = true;
});

loyaltyAddressInput.addEventListener("input", () => {
    loyaltyAddressResult.hidden = true;
});

entryModeInputs.forEach((input) => {
    input.addEventListener("change", () => setEntryMode(input.value));
});

itemForm.addEventListener("submit", (event) => event.preventDefault());
addProductRowButton.addEventListener("click", () => addProductRow(true));
productRows.addEventListener("input", (event) => {
    if (event.target.matches("[data-field]")) {
        updateProductField(event.target);
    }
});
productRows.addEventListener("change", (event) => {
    if (event.target.matches("[data-field]")) {
        updateProductField(event.target);
        return;
    }

    if (event.target.matches(".product-photo-input")) {
        handleProductPhotoFiles(event);
    }
});
productRows.addEventListener("click", (event) => {
    const photoChoiceButton = event.target.closest(".open-product-photo-choice");
    if (photoChoiceButton) {
        const menu = productRows.querySelector(`.product-photo-choice-menu[data-id="${photoChoiceButton.dataset.id}"]`);
        const willOpen = menu?.hidden;
        productRows.querySelectorAll(".product-photo-choice-menu").forEach((currentMenu) => {
            currentMenu.hidden = true;
        });
        productRows.querySelectorAll(".open-product-photo-choice").forEach((button) => {
            button.setAttribute("aria-expanded", "false");
        });
        if (menu) {
            menu.hidden = !willOpen;
            photoChoiceButton.setAttribute("aria-expanded", String(willOpen));
        }
        return;
    }

    const photoChoiceOption = event.target.closest(".product-photo-choice-option");
    if (photoChoiceOption) {
        const menu = photoChoiceOption.closest(".product-photo-choice-menu");
        const button = menu ? productRows.querySelector(`.open-product-photo-choice[data-id="${menu.dataset.id}"]`) : null;
        if (menu) {
            menu.hidden = true;
        }
        button?.setAttribute("aria-expanded", "false");
        return;
    }

    const rowButton = event.target.closest(".remove-product-row");
    if (rowButton) {
        removeProductRow(rowButton.dataset.id);
        return;
    }

    const photoButton = event.target.closest(".remove-product-photo");
    if (photoButton) {
        removeProductPhoto(photoButton.dataset.itemId, photoButton.dataset.photoId);
    }
});
loyaltyForm.addEventListener("submit", checkLoyaltyPoints);
checkAddressButton.addEventListener("click", checkAddressSupport);
itemList.addEventListener("click", removeItem);
photoPreview.addEventListener("click", removePhoto);
cameraInput.addEventListener("change", handlePhotoFiles);
photoUploadInput.addEventListener("change", handlePhotoFiles);
submitOrder.addEventListener("click", openOrderModal);
closeModal.addEventListener("click", closeOrderModal);
confirmOrder.addEventListener("click", finishOrder);

cancelEditOrderButton.addEventListener("click", () => {
    stopOrderModification();
    showToast("Änderung abgebrochen. Ihre Bestellung bleibt unverändert.", 4200);
});

existingPhotosList.addEventListener("click", (event) => {
    const toggleButton = event.target.closest(".toggle-existing-photo");
    if (!toggleButton || !state.editingOrder) {
        return;
    }

    const photo = state.editingOrder.existingPhotos.find((currentPhoto) => currentPhoto.filename === toggleButton.dataset.filename);
    if (!photo) {
        return;
    }

    photo.keep = !photo.keep;
    renderExistingPhotos();
    renderSummary();
});

orderStatusList.addEventListener("click", async (event) => {
    const modifyButton = event.target.closest(".modify-order-button");
    if (modifyButton) {
        modifyButton.disabled = true;
        modifyButton.textContent = "Wird geladen ...";
        await startOrderModification(modifyButton.dataset.id);
        renderOrderStatuses();
        return;
    }

    const cancelButton = event.target.closest(".cancel-order-button");
    if (cancelButton) {
        cancelButton.disabled = true;
        cancelButton.textContent = "Wird storniert ...";
        try {
            await cancelTrackedOrder(cancelButton.dataset.id);
        } catch {
            showToast("Bestellung kann nicht mehr storniert werden.", 4200);
            await refreshTrackedOrders();
        }
        return;
    }

    const removeButton = event.target.closest(".remove-status-button");
    if (removeButton) {
        removeTrackedOrder(removeButton.dataset.id);
    }
});

orderModal.addEventListener("click", (event) => {
    if (event.target === orderModal) {
        closeOrderModal();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !orderModal.hidden) {
        closeOrderModal();
    }
});

if (state.items.length === 0) {
    state.items.push(createEmptyProduct());
}

renderDeliveryTimeOptions();
setEntryMode(document.querySelector('input[name="entryMode"]:checked')?.value || "photo");
render();
setContrastMode(localStorage.getItem("darkMode") === "true" || localStorage.getItem("contrastMode") === "true");
loadTrackedOrders();
renderOrderStatuses();
refreshTrackedOrders();
refreshCapacity();
window.setInterval(refreshTrackedOrders, ORDER_STATUS_POLL_MS);
window.setInterval(refreshCapacity, CAPACITY_POLL_MS);
