const STORAGE_KEY = "contactSaverCards";
const DELETED_KEY = "contactSaverDeletedCards";
const GIST_TOKEN_KEY = "contactSaverGistToken";
const GIST_ID_KEY = "contactSaverGistId";
const GIST_FILENAME = "contact-saver-data.json";
const QR_VERSION = "logo-qr-7";
const DEFAULT_QR_FOREGROUND = "#000000";
const DEFAULT_QR_LOGO_SIZE = 17;
const MIN_QR_LOGO_SIZE = 8;
const MAX_QR_LOGO_SIZE = 18;
const QR_CAPACITY_H = 1273; // bytes at error-correction H (logo present, 30% recovery)
const QR_CAPACITY_M = 2331; // bytes at error-correction M (no logo, less dense = easier to scan)

const state = {
  contacts: [],
  deleted: [],
  selected: null,
  showingDeleted: false,
  qrLogoDataUrl: "",
  qrLogoImage: null,
  qrTransparentBackground: false,
  qrLogoSize: DEFAULT_QR_LOGO_SIZE,
  qrForeground: DEFAULT_QR_FOREGROUND
};

const createView = document.querySelector("#createView");
const savedView = document.querySelector("#savedView");
const form = document.querySelector("#contactForm");
const phoneFields = document.querySelector("#phoneFields");
const addPhoneButton = document.querySelector("#addPhone");
const listEl = document.querySelector("#contactList");
const countEl = document.querySelector("#contactCount");
const messageEl = document.querySelector("#formMessage");
const qrCanvas = document.querySelector("#qrCanvas");
const qrError = document.querySelector("#qrError");
const qrLogoInput = document.querySelector("#qrLogo");
const removeQrLogoButton = document.querySelector("#removeQrLogo");
const logoMessage = document.querySelector("#logoMessage");
const transparentQrInput = document.querySelector("#transparentQr");
const qrLogoSizeInput = document.querySelector("#qrLogoSize");
const qrLogoSizeValue = document.querySelector("#qrLogoSizeValue");
const qrForegroundInput = document.querySelector("#qrForeground");
const previewCard = document.querySelector("#previewCard");
const downloadVcf = document.querySelector("#downloadVcf");
const savedTitle = document.querySelector("#savedTitle");
const deletedToggle = document.querySelector("#deletedToggle");
let qrLibraryPromise = null;
let autosaveTimer = null;
let isHydratingForm = false;
let gistPushTimer = null;

function clean(value) {
  return String(value || "").trim();
}

function normalizeQrLogoSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_QR_LOGO_SIZE;
  return Math.min(MAX_QR_LOGO_SIZE, Math.max(MIN_QR_LOGO_SIZE, Math.round(size)));
}

function normalizeQrForeground(value) {
  return value === "#ffffff" ? "#ffffff" : DEFAULT_QR_FOREGROUND;
}

function vcardByteSize(contact) {
  return new TextEncoder().encode(vcardFor(contact)).length;
}

function qrLevel(contact) {
  // H is required to survive the centre logo punch-out. Without a logo, M
  // keeps the QR far less dense so phone cameras (incl. Samsung) scan it easily.
  return contact?.qrLogoDataUrl ? "H" : "M";
}

function qrCapacity(contact) {
  return qrLevel(contact) === "H" ? QR_CAPACITY_H : QR_CAPACITY_M;
}

function fileSafeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "contact";
}

function downloadSafeName(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "Contact";
}

function draftName() {
  const stamp = new Date().toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `Untitled Contact ${stamp}`;
}

function contactDisplayName(contact) {
  return clean(contact?.company) || clean(contact?.fullName) || clean(contact?.displayName) || draftName();
}

function avatarHtml(contact, extraClass = "") {
  return `<div class="avatar ${extraClass}">${escapeHtml(initials(contactDisplayName(contact)))}</div>`;
}

function initials(name) {
  return clean(name).split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("") || "CS";
}

function titleLine(contact) {
  if (contact.company) return clean(contact.role);
  return [contact.role, contact.company].filter(Boolean).join(" at ");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeVCard(value) {
  return clean(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function splitLegacyPhone(value) {
  const text = clean(value);
  const match = text.match(/^(\+\d{1,4})[\s().-]*(.*)$/);
  if (!match) return { label: "Mobile", countryCode: "+91", number: text };
  return { label: "Mobile", countryCode: match[1], number: match[2] };
}

function looksLikePhone(value) {
  const text = clean(value);
  if (!text || /[a-z]/i.test(text)) return false;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 6 && /^[+\d\s().-]+$/.test(text);
}

function splitPhoneNumber(value, fallbackCountryCode = "+91") {
  const text = clean(value);
  const match = text.match(/^(\+\d{1,4})[\s().-]*(.+)$/);
  if (match) {
    return { countryCode: match[1], number: clean(match[2]) };
  }
  return { countryCode: fallbackCountryCode, number: text };
}

function normalizeWebsiteEntry(entry) {
  if (typeof entry === "string") return { label: "Website", url: clean(entry) };
  return { label: clean(entry?.label) || "Website", url: clean(entry?.url || entry?.website) };
}

function normalizeWebsiteEntries(contact) {
  if (Array.isArray(contact.websites) && contact.websites.length) {
    return contact.websites.map(normalizeWebsiteEntry);
  }
  if (clean(contact.website)) {
    return [{ label: "Website", url: clean(contact.website) }];
  }
  return [{ label: "Website", url: "" }];
}

function normalizePhoneEntry(entry, index = 0) {
  if (typeof entry === "string") return splitLegacyPhone(entry);
  const label = clean(entry?.label) || (index === 0 ? "Mobile" : "");
  return {
    label,
    countryCode: clean(entry?.countryCode) || "+91",
    number: clean(entry?.number || entry?.phone)
  };
}

function normalizePhoneEntries(contact) {
  const rawEntries = Array.isArray(contact.phones) ? contact.phones : [contact.phone];
  const entries = rawEntries.map(normalizePhoneEntry);
  return entries.length ? entries : [{ label: "Mobile", countryCode: "+91", number: "" }];
}

function fullPhone(entry) {
  const phone = normalizePhoneEntry(entry);
  const number = clean(phone.number);
  const countryCode = clean(phone.countryCode);
  if (!number) return "";
  if (number.startsWith("+")) return number;
  return [countryCode, number].filter(Boolean).join(" ");
}

// Labels that map cleanly to a native phone category on every platform.
const STANDARD_PHONE_LABELS = ["", "mobile", "cell", "phone", "home", "work", "office", "landline", "main", "fax", "pager", "personal", "other"];

function vcardPhoneTypes(label) {
  const value = clean(label).toLowerCase();
  if (value.includes("landline") || value.includes("office") || value.includes("work") || value.includes("department") || value.includes("sales") || value.includes("marketing")) {
    return ["WORK", "VOICE"];
  }
  if (value.includes("home") || value.includes("personal")) return ["HOME", "VOICE"];
  return ["CELL", "VOICE"];
}

// Turn any label into a single safe TYPE token: strip the characters that
// would break vCard parameter parsing (comma splits values, semicolon/colon
// end the param, backslash escapes), keep spaces so the name stays readable.
function phoneTypeToken(label) {
  return clean(label).replace(/[,;:\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

function vcardPhoneParameters(label) {
  const lower = clean(label).toLowerCase();
  if (STANDARD_PHONE_LABELS.includes(lower)) {
    // Known label -> native category dropdown on every device.
    return `;TYPE=${vcardPhoneTypes(label).join(",")}`;
  }
  // Custom label (a name, role, anything): push the exact text into TYPE so
  // Android's quick "Add to contacts" shows it as the label. A non-empty TYPE
  // is always present, so the number still imports on Samsung/AOSP too.
  const token = phoneTypeToken(label);
  return token ? `;TYPE=${token}` : `;TYPE=${vcardPhoneTypes(label).join(",")}`;
}

function normalizeContact(contact) {
  return {
    id: contact.id || crypto.randomUUID(),
    fullName: clean(contact.fullName),
    role: clean(contact.role),
    company: clean(contact.company),
    phones: normalizePhoneEntries(contact),
    email: clean(contact.email).toLowerCase(),
    websites: normalizeWebsiteEntries(contact),
    address: clean(contact.address),
    qrLogoDataUrl: clean(contact.qrLogoDataUrl),
    qrTransparentBackground: Boolean(contact.qrTransparentBackground),
    qrLogoSize: normalizeQrLogoSize(contact.qrLogoSize),
    qrForeground: normalizeQrForeground(contact.qrForeground),
    deletedAt: contact.deletedAt || "",
    updatedAt: contact.updatedAt || new Date().toISOString()
  };
}

function contactNameParts(contact) {
  const displayName = clean(contact.fullName) || clean(contact.company) || contactDisplayName(contact);
  const parts = displayName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      displayName,
      firstName: displayName,
      middleName: "",
      lastName: ""
    };
  }
  if (parts.length === 2) {
    return {
      displayName,
      firstName: parts[0],
      middleName: "",
      lastName: parts[1]
    };
  }
  return {
    displayName,
    firstName: parts.slice(0, -2).join(" "),
    middleName: parts[parts.length - 2],
    lastName: parts[parts.length - 1]
  };
}

function vcardFor(contact) {
  const name = contactNameParts(contact);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(name.lastName)};${escapeVCard(name.firstName)};${escapeVCard(name.middleName)};;`,
    `FN:${escapeVCard(name.displayName)}`
  ];

  if (contact.company) lines.push(`ORG:${escapeVCard(contact.company)}`);
  if (contact.company) lines.push("X-ABShowAs:COMPANY");
  if (contact.role) lines.push(`TITLE:${escapeVCard(contact.role)}`);

  let itemIndex = 1;
  normalizePhoneEntries(contact).forEach(entry => {
    const phone = fullPhone(entry);
    if (!phone) return;
    const label = clean(entry.label) || "Mobile";
    const item = `item${itemIndex}`;
    itemIndex += 1;
    // ALWAYS emit a standard TYPE (CELL/WORK/HOME,VOICE). A TEL with no TYPE
    // is dropped by Samsung/AOSP parsers, so this guarantees the number
    // imports on every phone. The grouped X-ABLabel carries the exact custom
    // text for iOS/Google Contacts; Android quick-add shows the standard
    // category but the number always lands.
    lines.push(`${item}.TEL${vcardPhoneParameters(label)}:${escapeVCard(phone)}`);
    lines.push(`${item}.X-ABLabel:${escapeVCard(label)}`);
  });
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(contact.email)}`);
  normalizeWebsiteEntries(contact).forEach(entry => {
    if (!entry.url) return;
    const item = `item${itemIndex}`;
    itemIndex += 1;
    lines.push(`${item}.URL:${escapeVCard(entry.url)}`);
    lines.push(`${item}.X-ABLabel:${escapeVCard(entry.label || "Website")}`);
  });
  if (contact.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(contact.address)};;;;`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function saveContacts() {
  persistLocal(STORAGE_KEY, state.contacts);
  scheduleGistPush();
  scheduleApiSync();
}

function saveDeleted() {
  persistLocal(DELETED_KEY, state.deleted);
  scheduleGistPush();
  scheduleApiSync();
}

function persistLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    messageEl.style.color = "var(--danger)";
    messageEl.textContent = "Storage is full. Delete old cards, then try again.";
    return false;
  }
}

function hasMeaningfulContactData(contact) {
  if (!contact) return false;
  return Boolean(
    clean(contact.fullName) ||
    clean(contact.role) ||
    clean(contact.company) ||
    clean(contact.email) ||
    clean(contact.address) ||
    normalizePhoneEntries(contact).some(entry => fullPhone(entry)) ||
    normalizeWebsiteEntries(contact).some(entry => entry.url)
  );
}

function formHasContent() {
  return Boolean(
    clean(form.fullName.value) ||
    clean(form.role.value) ||
    clean(form.company.value) ||
    clean(form.email.value) ||
    clean(form.address.value) ||
    phoneValuesFromForm().length ||
    websiteValuesFromForm().length
  );
}

function upsertContact(contact) {
  const normalized = { ...normalizeContact(contact), deletedAt: "" };
  const existing = state.contacts.some(item => item.id === normalized.id);
  state.contacts = existing
    ? state.contacts.map(item => item.id === normalized.id ? normalized : item)
    : [normalized, ...state.contacts];
  saveContacts();
  return normalized;
}

function removeFromDeleted(id) {
  state.deleted = state.deleted.filter(contact => contact.id !== id);
  saveDeleted();
}

function moveToDeleted(contact) {
  const normalized = { ...normalizeContact(contact), deletedAt: new Date().toISOString() };
  state.deleted = [normalized, ...state.deleted.filter(item => item.id !== normalized.id)];
  saveDeleted();
}

function autosaveCurrentForm() {
  if (isHydratingForm) return null;
  repairPhoneAutofill();
  if (!formHasContent()) return null;
  const contact = contactFromForm({ allowUntitled: true });
  if (!hasMeaningfulContactData(contact)) return null;
  const saved = upsertContact(contact);
  removeFromDeleted(saved.id);
  state.selected = saved;
  form.id.value = saved.id;
  renderList();
  renderPreview();
  return saved;
}

function scheduleAutosave() {
  if (isHydratingForm) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const saved = autosaveCurrentForm();
    if (saved) {
      messageEl.style.color = "var(--success)";
      messageEl.textContent = "Autosaved.";
    }
  }, 350);
}

function loadContacts() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  const deleted = JSON.parse(localStorage.getItem(DELETED_KEY) || "null");

  state.contacts = (Array.isArray(saved) ? saved : [])
    .map(normalizeContact)
    .filter(hasMeaningfulContactData);
  state.deleted = (Array.isArray(deleted) ? deleted : [])
    .map(normalizeContact)
    .filter(hasMeaningfulContactData);
  state.selected = null;
  saveContacts();
  saveDeleted();
}

function phoneValuesFromForm() {
  repairPhoneAutofill();
  return [...form.querySelectorAll(".phone-row")]
    .map((row, index) => normalizePhoneEntry({
      label: row.querySelector(".phone-label-input")?.value || (index === 0 ? "Mobile" : ""),
      countryCode: row.querySelector(".country-code-input")?.value || "+91",
      number: row.querySelector(".phone-number-input")?.value || ""
    }, index))
    .filter(entry => fullPhone(entry));
}

function repairPhoneAutofill() {
  let repaired = false;
  [...form.querySelectorAll(".phone-row")].forEach((row, index) => {
    const labelInput = row.querySelector(".phone-label-input");
    const countryInput = row.querySelector(".country-code-input");
    const numberInput = row.querySelector(".phone-number-input");
    if (!labelInput || !countryInput || !numberInput) return;

    const label = clean(labelInput.value);
    const countryCode = clean(countryInput.value) || "+91";
    const number = clean(numberInput.value);

    if (looksLikePhone(label) && !number) {
      const parsed = splitPhoneNumber(label, countryCode);
      countryInput.value = parsed.countryCode || countryCode;
      numberInput.value = parsed.number;
      labelInput.value = index === 0 ? "Mobile" : "";
      repaired = true;
    }

    if (looksLikePhone(clean(countryInput.value)) && !clean(numberInput.value)) {
      const parsed = splitPhoneNumber(countryInput.value, "+91");
      countryInput.value = parsed.countryCode;
      numberInput.value = parsed.number;
      repaired = true;
    }

    if (/^\+\d{1,4}[\s().-]+\d/.test(clean(numberInput.value))) {
      const parsed = splitPhoneNumber(numberInput.value, clean(countryInput.value) || "+91");
      countryInput.value = parsed.countryCode;
      numberInput.value = parsed.number;
      repaired = true;
    }
  });
  return repaired;
}

function addIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
}

function deleteIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14M10 11v5M14 11v5"/></svg>';
}

const websiteFields = document.querySelector("#websiteFields");

function websiteRowHtml(entry = {}, rowCount = 1) {
  const w = normalizeWebsiteEntry(entry);
  return `
    <div class="website-row">
      <input class="website-label-input" value="${escapeHtml(w.label)}" placeholder="Website, Instagram, Maps…" autocomplete="off" aria-label="Link label">
      <input class="website-url-input" value="${escapeHtml(w.url)}" placeholder="https://…" inputmode="url" autocomplete="url" aria-label="URL">
      <button class="circle-button add-website" type="button" aria-label="Add link">${addIcon()}</button>
      <button class="circle-button remove-website" type="button" aria-label="Remove link" ${rowCount === 1 ? "disabled" : ""}>${deleteIcon()}</button>
    </div>
  `;
}

function renderWebsiteFields(websites = []) {
  const values = websites.length ? websites : [{ label: "Website", url: "" }];
  websiteFields.innerHTML = values.map(w => websiteRowHtml(w, values.length)).join("");
}

function websiteValuesFromForm() {
  return [...websiteFields.querySelectorAll(".website-row")]
    .map(row => normalizeWebsiteEntry({
      label: row.querySelector(".website-label-input")?.value || "Website",
      url: row.querySelector(".website-url-input")?.value || ""
    }))
    .filter(entry => entry.url);
}

function phoneRowHtml(entry = {}, index = 0, rowCount = 1) {
  const phone = normalizePhoneEntry(entry, index);
  const labelPlaceholder = index === 0 ? "Mobile" : "Landline, Sales, Marketing";
  const labelValue = phone.label || (index === 0 ? "Mobile" : "");
  const section = `section-phone-${index + 1}`;
  return `
    <div class="phone-row">
      <input class="phone-label-input" value="${escapeHtml(labelValue)}" placeholder="${escapeHtml(labelPlaceholder)}" autocomplete="off" readonly aria-label="Number type">
      <input class="country-code-input" value="${escapeHtml(phone.countryCode)}" placeholder="+91" list="countryCodes" inputmode="tel" autocomplete="off" aria-label="Country code">
      <input class="phone-number-input" value="${escapeHtml(phone.number)}" placeholder="9820942844" inputmode="tel" autocomplete="tel" aria-label="Phone number">
      <button class="circle-button add-phone" type="button" aria-label="Add phone number">${addIcon()}</button>
      <button class="circle-button remove-phone" type="button" aria-label="Remove phone number" ${rowCount === 1 ? "disabled" : ""}>${deleteIcon()}</button>
    </div>
  `;
}

function renderPhoneFields(phones = []) {
  const values = normalizePhoneEntries({ phones });
  phoneFields.innerHTML = values.map((phone, index) => phoneRowHtml(phone, index, values.length)).join("");
}

function fillForm(contact = {}) {
  clearTimeout(autosaveTimer);
  isHydratingForm = true;
  const normalized = contact.id ? normalizeContact(contact) : contact;
  form.id.value = normalized.id || "";
  form.fullName.value = normalized.fullName || "";
  form.role.value = normalized.role || "";
  form.company.value = normalized.company || "";
  form.email.value = normalized.email || "";
  form.address.value = normalized.address || "";
  renderPhoneFields(normalizePhoneEntries(normalized));
  renderWebsiteFields(normalizeWebsiteEntries(normalized));
  isHydratingForm = false;
}

function contactFromForm(options = {}) {
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = state.contacts.find(contact => contact.id === data.id);
  const fullName = clean(data.fullName);
  const company = clean(data.company);
  if (!fullName && !company && !options.allowUntitled) throw new Error("Add full name or company name");

  return {
    id: existing?.id || crypto.randomUUID(),
    fullName: fullName || (company ? "" : draftName()),
    role: clean(data.role),
    company,
    phones: phoneValuesFromForm(),
    email: clean(data.email).toLowerCase(),
    websites: websiteValuesFromForm(),
    address: clean(data.address),
    qrLogoDataUrl: state.qrLogoDataUrl,
    qrTransparentBackground: state.qrTransparentBackground,
    qrLogoSize: state.qrLogoSize,
    qrForeground: state.qrForeground,
    updatedAt: new Date().toISOString()
  };
}

function updateVcfLink(contact) {
  const blob = new Blob([vcardFor(contact)], { type: "text/vcard;charset=utf-8" });
  if (downloadVcf.dataset.url) URL.revokeObjectURL(downloadVcf.dataset.url);
  const url = URL.createObjectURL(blob);
  downloadVcf.dataset.url = url;
  downloadVcf.href = url;
  downloadVcf.download = `${fileSafeName(contactDisplayName(contact))}.vcf`;
}

function waitForQrLibrary() {
  if (window.QRious) return Promise.resolve(window.QRious);
  if (qrLibraryPromise) return qrLibraryPromise;

  qrLibraryPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const existingScript = document.querySelector('script[src*="qrious.min.js"]');

    function finishIfReady() {
      if (window.QRious) {
        resolve(window.QRious);
        return true;
      }
      return false;
    }

    if (finishIfReady()) return;

    const timer = setInterval(() => {
      if (finishIfReady()) {
        clearInterval(timer);
        return;
      }
      if (Date.now() - startedAt > 8000) {
        clearInterval(timer);
        reject(new Error("QR generator could not load. Please hard refresh with Ctrl + F5."));
      }
    }, 80);

    if (existingScript) {
      existingScript.addEventListener("load", finishIfReady, { once: true });
      existingScript.addEventListener("error", () => {
        clearInterval(timer);
        reject(new Error("QR generator file failed to load."));
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `qrious.min.js?v=${QR_VERSION}`;
    script.defer = true;
    script.addEventListener("load", finishIfReady, { once: true });
    script.addEventListener("error", () => {
      clearInterval(timer);
      reject(new Error("QR generator file failed to load."));
    }, { once: true });
    document.head.appendChild(script);
  });

  return qrLibraryPromise;
}

async function drawQr(canvas, contact, size, padding) {
  await waitForQrLibrary();
  const transparentBackground = Boolean(contact?.qrTransparentBackground);
  const foreground = normalizeQrForeground(contact?.qrForeground);
  const background = foreground === "#ffffff" ? "#000000" : "#ffffff";
  new QRious({
    element: canvas,
    value: vcardFor(contact),
    size,
    padding,
    level: qrLevel(contact),
    foreground,
    background,
    backgroundAlpha: transparentBackground ? 0 : 1
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded. Try a PNG or JPG file."));
    image.src = source;
  });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file for the QR center."));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      reject(new Error("Choose an image under 4 MB so the QR stays reliable."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function setQrLogoState(source, message = "") {
  state.qrLogoDataUrl = clean(source);
  state.qrLogoImage = null;
  if (state.qrLogoDataUrl) {
    try {
      state.qrLogoImage = await loadImage(state.qrLogoDataUrl);
    } catch {
      state.qrLogoDataUrl = "";
      logoMessage.style.color = "var(--danger)";
      logoMessage.textContent = "Saved image could not be loaded.";
    }
  }
  qrLogoInput.value = "";
  removeQrLogoButton.hidden = !state.qrLogoImage;
  if (!state.qrLogoDataUrl || !logoMessage.textContent || message) {
    logoMessage.style.color = state.qrLogoImage ? "var(--success)" : "var(--muted)";
    logoMessage.textContent = message;
  }
}

function setQrDesignState(contact = {}) {
  state.qrTransparentBackground = Boolean(contact.qrTransparentBackground);
  state.qrLogoSize = normalizeQrLogoSize(contact.qrLogoSize);
  state.qrForeground = normalizeQrForeground(contact.qrForeground);
  transparentQrInput.checked = state.qrTransparentBackground;
  qrLogoSizeInput.value = String(state.qrLogoSize);
  qrLogoSizeValue.textContent = `${state.qrLogoSize}%`;
  qrForegroundInput.value = state.qrForeground;
}

async function loadLogoForContact(contact) {
  const source = clean(contact?.qrLogoDataUrl);
  if (!source) return null;
  if (source === state.qrLogoDataUrl && state.qrLogoImage) return state.qrLogoImage;
  try {
    return await loadImage(source);
  } catch {
    return null;
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawQrLogo(canvas, image, logoSizePercent = DEFAULT_QR_LOGO_SIZE, transparentBackground = false) {
  if (!image) return;
  const context = canvas.getContext("2d");
  const size = Math.min(canvas.width, canvas.height);
  const logoSize = Math.round(size * normalizeQrLogoSize(logoSizePercent) / 100);
  const badgePadding = transparentBackground ? 0 : Math.round(size * 0.025);
  const badgeSize = logoSize + badgePadding * 2;
  const badgeX = Math.round((canvas.width - badgeSize) / 2);
  const badgeY = Math.round((canvas.height - badgeSize) / 2);
  const logoX = badgeX + badgePadding;
  const logoY = badgeY + badgePadding;
  const radius = Math.round(size * 0.025);

  context.save();
  if (!transparentBackground) {
    context.fillStyle = "#ffffff";
    roundedRect(context, badgeX, badgeY, badgeSize, badgeSize, radius);
    context.fill();
    context.strokeStyle = "rgba(23, 32, 51, 0.16)";
    context.lineWidth = Math.max(1, Math.round(size * 0.004));
    context.stroke();
  }

  const scale = Math.min(logoSize / image.naturalWidth, logoSize / image.naturalHeight);
  const drawWidth = Math.round(image.naturalWidth * scale);
  const drawHeight = Math.round(image.naturalHeight * scale);
  const drawX = Math.round(logoX + (logoSize - drawWidth) / 2);
  const drawY = Math.round(logoY + (logoSize - drawHeight) / 2);

  roundedRect(context, logoX, logoY, logoSize, logoSize, Math.round(radius * 0.72));
  context.clip();
  if (transparentBackground) context.clearRect(logoX, logoY, logoSize, logoSize);
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}

function findQrBounds(canvas, foreground = DEFAULT_QR_FOREGROUND) {
  const context = canvas.getContext("2d");
  const findLightModules = normalizeQrForeground(foreground) === "#ffffff";
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const isModule = findLightModules
        ? pixels[index] > 159 && pixels[index + 1] > 159 && pixels[index + 2] > 159
        : pixels[index] < 96 && pixels[index + 1] < 96 && pixels[index + 2] < 96;
      if (pixels[index + 3] > 0 && isModule) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

async function drawCenteredQr(canvas, contact, size, quietZone, logoImage = state.qrLogoImage) {
  const source = document.createElement("canvas");
  await drawQr(source, contact, size - quietZone * 2, null);
  const bounds = findQrBounds(source, contact.qrForeground);
  const context = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;
  context.imageSmoothingEnabled = false;
  if (!contact.qrTransparentBackground) {
    context.fillStyle = normalizeQrForeground(contact.qrForeground) === "#ffffff" ? "#000000" : "#ffffff";
    context.fillRect(0, 0, size, size);
  }

  if (!bounds) return;
  const x = Math.round((size - bounds.width) / 2);
  const y = Math.round((size - bounds.height) / 2);
  context.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    x,
    y,
    bounds.width,
    bounds.height
  );
  drawQrLogo(canvas, logoImage, contact.qrLogoSize, contact.qrTransparentBackground);
}

function updateQrMeter(contact) {
  const meter = document.querySelector("#qrMeter");
  if (!meter) return;
  const bytes = vcardByteSize(contact);
  const capacity = qrCapacity(contact);
  const pct = Math.min(100, Math.round(bytes / capacity * 100));
  const fill = meter.querySelector(".qr-meter-fill");
  const label = meter.querySelector(".qr-meter-label");
  fill.style.width = pct + "%";
  fill.style.background = pct < 60 ? "var(--success)" : pct < 85 ? "#f59e0b" : "var(--danger)";
  label.textContent = `${bytes} / ${capacity} bytes · ${pct}%`;
  meter.hidden = false;
}

let renderQrGeneration = 0;

async function renderQr(contact) {
  const generation = ++renderQrGeneration;
  qrError.hidden = true;
  qrCanvas.hidden = false;
  qrCanvas.classList.toggle("is-transparent", Boolean(contact.qrTransparentBackground));
  qrCanvas.classList.toggle("is-white-qr", normalizeQrForeground(contact.qrForeground) === "#ffffff");
  updateQrMeter(contact);
  try {
    await drawQr(qrCanvas, contact, 640, null);
    if (generation !== renderQrGeneration) return;
    drawQrLogo(qrCanvas, await loadLogoForContact(contact), contact.qrLogoSize, contact.qrTransparentBackground);
  } catch (error) {
    if (generation !== renderQrGeneration) return;
    qrCanvas.hidden = true;
    qrError.hidden = false;
    qrError.textContent = error.message;
  }
}

async function createQrDownloadCanvas(contact) {
  const qrSize = 1800;
  const canvas = document.createElement("canvas");
  await drawCenteredQr(canvas, contact, qrSize, 126, await loadLogoForContact(contact));
  return canvas;
}

function phoneSummary(contact) {
  const phones = normalizePhoneEntries(contact).map(fullPhone).filter(Boolean);
  return phones.length ? phones.join(" / ") : "No phone added";
}

function phoneLabelSummary(contact) {
  return normalizePhoneEntries(contact)
    .filter(entry => fullPhone(entry))
    .map(entry => `${clean(entry.label) || "Phone"}: ${fullPhone(entry)}`)
    .join(" / ") || "No phone added";
}

function listCompanyName(contact) {
  return clean(contact.company) || "No company added";
}

function listContactName(contact) {
  return clean(contact.fullName) || "No contact name added";
}

function renderPreview() {
  const contact = state.selected;
  if (!contact) {
    const context = qrCanvas.getContext("2d");
    context.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    qrCanvas.classList.remove("is-transparent");
    qrCanvas.classList.remove("is-white-qr");
    qrError.hidden = true;
    downloadVcf.removeAttribute("href");
    downloadVcf.removeAttribute("download");
    previewCard.innerHTML = `
      <div class="avatar">CS</div>
      <h3>Select a card</h3>
      <p>Create a contact to preview the QR details.</p>
    `;
    return;
  }

  previewCard.innerHTML = `
    ${avatarHtml(contact)}
    <h3>${escapeHtml(contactDisplayName(contact))}</h3>
    <p>${escapeHtml(titleLine(contact) || contact.email || phoneSummary(contact))}</p>
    <p>${escapeHtml(phoneLabelSummary(contact))}</p>
  `;
  updateVcfLink(contact);
  renderQr(contact);
}

function renderList() {
  const items = state.showingDeleted ? state.deleted : state.contacts;
  countEl.textContent = `${state.contacts.length} card${state.contacts.length === 1 ? "" : "s"}`;
  savedTitle.textContent = state.showingDeleted ? "Deleted cards" : "Saved cards";
  deletedToggle.textContent = state.showingDeleted ? "Saved Cards" : "Deleted Cards";
  deletedToggle.href = state.showingDeleted ? "#saved" : "#deleted";

  if (!items.length) {
    listEl.innerHTML = `<p class="muted">No ${state.showingDeleted ? "deleted" : "saved"} cards yet.</p>`;
    return;
  }

  listEl.innerHTML = items.map(contact => `
    <article class="contact-item" data-id="${escapeHtml(contact.id)}">
      <div class="contact-main">
        ${avatarHtml(contact)}
        <div>
          <h3>${escapeHtml(listCompanyName(contact))}</h3>
          <p>${escapeHtml(listContactName(contact))}</p>
          <p>${escapeHtml(phoneLabelSummary(contact))}</p>
        </div>
      </div>
      <div class="contact-actions">
        ${state.showingDeleted ? `
          <button class="icon-button" type="button" data-action="restore">Restore</button>
          <button class="icon-button danger" type="button" data-action="purge">Delete Forever</button>
        ` : `
          <button class="icon-button" type="button" data-action="select">Preview</button>
          <button class="icon-button" type="button" data-action="edit">Edit</button>
          <button class="icon-button danger" type="button" data-action="delete">Delete</button>
        `}
      </div>
    </article>
  `).join("");
}

function showView() {
  clearTimeout(autosaveTimer);
  if (location.hash === "#saved" || location.hash === "#deleted") autosaveCurrentForm();
  const showSaved = location.hash === "#saved" || location.hash === "#deleted";
  state.showingDeleted = location.hash === "#deleted";
  createView.hidden = showSaved;
  savedView.hidden = !showSaved;
  document.body.classList.toggle("saved-active", showSaved);
  if (showSaved) renderList();
}

async function selectContact(contact) {
  clearTimeout(autosaveTimer);
  const latest = state.contacts.find(candidate => candidate.id === contact.id) || contact;
  state.selected = latest;
  setQrDesignState(latest);
  await setQrLogoState(latest.qrLogoDataUrl, latest.qrLogoDataUrl ? "Card image loaded." : "");
  renderPreview();
  return latest;
}

async function openContactInEditor(contact, message = "") {
  clearTimeout(autosaveTimer);
  const selected = await selectContact(contact);
  fillForm(selected);
  messageEl.textContent = message;
  if (message) messageEl.style.color = "var(--success)";
  if (location.hash) {
    location.hash = "";
  } else {
    showView();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

phoneFields.addEventListener("focusin", event => {
  const labelInput = event.target.closest(".phone-label-input");
  if (labelInput) labelInput.removeAttribute("readonly");
});

phoneFields.addEventListener("click", event => {
  const addButton = event.target.closest(".add-phone");
  if (addButton) {
    clearTimeout(autosaveTimer);
    const nextIndex = phoneFields.querySelectorAll(".phone-row").length;
    phoneFields.insertAdjacentHTML("beforeend", phoneRowHtml({ label: "", countryCode: "+91", number: "" }, nextIndex, nextIndex + 1));
    phoneFields.querySelectorAll(".remove-phone").forEach(button => {
      button.disabled = false;
    });
    phoneFields.querySelector(".phone-row:last-child .phone-label-input")?.focus();
    scheduleAutosave();
    return;
  }

  const button = event.target.closest(".remove-phone");
  if (!button) return;
  clearTimeout(autosaveTimer);
  button.closest(".phone-row")?.remove();
  const rows = phoneFields.querySelectorAll(".phone-row");
  if (!rows.length) renderPhoneFields([{ label: "Mobile", countryCode: "+91", number: "" }]);
  if (rows.length === 1) rows[0].querySelector(".remove-phone").disabled = true;
  scheduleAutosave();
});

websiteFields.addEventListener("click", event => {
  if (event.target.closest(".add-website")) {
    clearTimeout(autosaveTimer);
    const rowCount = websiteFields.querySelectorAll(".website-row").length;
    websiteFields.insertAdjacentHTML("beforeend", websiteRowHtml({ label: "", url: "" }, rowCount + 1));
    websiteFields.querySelectorAll(".remove-website").forEach(btn => { btn.disabled = false; });
    websiteFields.querySelector(".website-row:last-child .website-label-input")?.focus();
    scheduleAutosave();
    return;
  }
  const removeBtn = event.target.closest(".remove-website");
  if (!removeBtn) return;
  clearTimeout(autosaveTimer);
  removeBtn.closest(".website-row")?.remove();
  const rows = websiteFields.querySelectorAll(".website-row");
  if (!rows.length) renderWebsiteFields([]);
  if (rows.length === 1) rows[0].querySelector(".remove-website").disabled = true;
  scheduleAutosave();
});

if (addPhoneButton) {
  addPhoneButton.addEventListener("click", () => {
    clearTimeout(autosaveTimer);
    phoneFields.insertAdjacentHTML("beforeend", phoneRowHtml({ label: "", countryCode: "+91", number: "" }, phoneFields.querySelectorAll(".phone-row").length, 2));
    phoneFields.querySelector(".phone-row:last-child .phone-label-input")?.focus();
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  clearTimeout(autosaveTimer);
  messageEl.style.color = "var(--success)";
  try {
    const contact = contactFromForm();
    const saved = upsertContact(contact);
    removeFromDeleted(saved.id);
    state.selected = saved;
    setQrDesignState(saved);
    await setQrLogoState(saved.qrLogoDataUrl, saved.qrLogoDataUrl ? "Card image saved." : "");
    fillForm(saved);
    renderList();
    renderPreview();
    messageEl.textContent = "Saved. QR updated.";
  } catch (error) {
    messageEl.style.color = "var(--danger)";
    messageEl.textContent = error.message;
  }
});

document.querySelector("#resetForm").addEventListener("click", async () => {
  clearTimeout(autosaveTimer);
  const saved = autosaveCurrentForm();
  state.selected = null;
  setQrDesignState();
  await setQrLogoState("");
  fillForm();
  messageEl.textContent = "";
  renderPreview();
  if (saved) {
    messageEl.style.color = "var(--success)";
    messageEl.textContent = "Previous work saved. New card ready.";
  }
});

listEl.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = event.target.closest(".contact-item");
  const source = state.showingDeleted ? state.deleted : state.contacts;
  const contact = source.find(candidate => candidate.id === item.dataset.id);
  if (!contact) return;

  if (button.dataset.action === "select") {
    await openContactInEditor(contact);
  }
  if (button.dataset.action === "edit") {
    await openContactInEditor(contact, "Editing saved card.");
  }
  if (button.dataset.action === "delete") {
    clearTimeout(autosaveTimer);
    moveToDeleted(contact);
    state.contacts = state.contacts.filter(candidate => candidate.id !== contact.id);
    if (state.selected?.id === contact.id || form.id.value === contact.id) {
      state.selected = null;
      await setQrLogoState("");
      fillForm();
      renderPreview();
    }
    saveContacts();
    renderList();
  }
  if (button.dataset.action === "restore") {
    clearTimeout(autosaveTimer);
    const restored = upsertContact(contact);
    removeFromDeleted(contact.id);
    state.selected = restored;
    setQrDesignState(restored);
    await setQrLogoState(restored.qrLogoDataUrl, restored.qrLogoDataUrl ? "Card image loaded." : "");
    renderPreview();
    renderList();
  }
  if (button.dataset.action === "purge") {
    clearTimeout(autosaveTimer);
    state.deleted = state.deleted.filter(candidate => candidate.id !== contact.id);
    if (state.selected?.id === contact.id) {
      state.selected = null;
      renderPreview();
    }
    saveDeleted();
    renderList();
  }
});

qrLogoInput.addEventListener("change", async () => {
  const file = qrLogoInput.files?.[0];
  logoMessage.style.color = "var(--muted)";
  logoMessage.textContent = file ? "Adding image to QR..." : "";

  try {
    const source = await readImageFile(file);
    await setQrLogoState(source, source ? "Image added to this card." : "");
    const saved = autosaveCurrentForm();
    if (saved) {
      logoMessage.style.color = "var(--success)";
      logoMessage.textContent = "Image saved to this card.";
    }
  } catch (error) {
    await setQrLogoState("");
    logoMessage.style.color = "var(--danger)";
    logoMessage.textContent = error.message;
    if (state.selected) renderQr(state.selected);
  }
});

removeQrLogoButton.addEventListener("click", async () => {
  await setQrLogoState("");
  logoMessage.textContent = "";
  const saved = autosaveCurrentForm();
  if (saved) {
    logoMessage.style.color = "var(--success)";
    logoMessage.textContent = "Image removed from this card.";
  } else if (state.selected) {
    renderQr(state.selected);
  }
});

function saveQrDesignChange() {
  state.qrTransparentBackground = transparentQrInput.checked;
  state.qrLogoSize = normalizeQrLogoSize(qrLogoSizeInput.value);
  state.qrForeground = normalizeQrForeground(qrForegroundInput.value);
  qrLogoSizeValue.textContent = `${state.qrLogoSize}%`;

  if (state.selected) {
    state.selected = upsertContact({
      ...state.selected,
      qrTransparentBackground: state.qrTransparentBackground,
      qrLogoSize: state.qrLogoSize,
      qrForeground: state.qrForeground,
      updatedAt: new Date().toISOString()
    });
    renderList();
    renderPreview();
    return;
  }
  autosaveCurrentForm();
}

transparentQrInput.addEventListener("change", saveQrDesignChange);
qrLogoSizeInput.addEventListener("input", saveQrDesignChange);
qrForegroundInput.addEventListener("change", saveQrDesignChange);

document.querySelector("#downloadQr").addEventListener("click", async () => {
  const contact = state.selected;
  if (!contact) return;
  try {
    const canvas = await createQrDownloadCanvas(contact);
    const link = document.createElement("a");
    link.download = `${downloadSafeName(contactDisplayName(contact))}_Contact-Qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    qrError.hidden = false;
    qrError.textContent = error.message;
  }
});

window.addEventListener("hashchange", showView);
window.addEventListener("beforeunload", autosaveCurrentForm);
window.addEventListener("pagehide", autosaveCurrentForm);
form.addEventListener("input", () => {
  if (repairPhoneAutofill()) {
    messageEl.style.color = "var(--success)";
    messageEl.textContent = "Phone moved to the correct box.";
  }
  scheduleAutosave();
});
form.addEventListener("change", () => {
  repairPhoneAutofill();
  scheduleAutosave();
});

// ── Backend API ─────────────────────────────────────────────────────────────

const API_URL = "https://YOUR_VPS_IP_OR_DOMAIN:4000"; // ← set your backend URL here
const API_TOKEN_KEY = "contactSaverApiToken";
const API_EMAIL_KEY = "contactSaverApiEmail";

let apiSyncTimer = null;

function apiToken() { return localStorage.getItem(API_TOKEN_KEY) || ""; }
function apiEmail() { return localStorage.getItem(API_EMAIL_KEY) || ""; }
function isApiLoggedIn() { return Boolean(apiToken()); }

function apiHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiToken()}` };
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: apiHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

async function apiLoadContacts() {
  if (!isApiLoggedIn()) return;
  try {
    const data = await apiRequest("GET", "/api/contacts");
    const remoteContacts = (data.contacts || []).map(normalizeContact).filter(hasMeaningfulContactData);
    const remoteDeleted  = (data.deleted  || []).map(normalizeContact).filter(hasMeaningfulContactData);
    const remoteIds = new Set(remoteContacts.map(c => c.id));
    const localOnly = state.contacts.filter(c => !remoteIds.has(c.id));
    state.contacts = [...remoteContacts, ...localOnly];
    state.deleted  = remoteDeleted;
    persistLocal(STORAGE_KEY, state.contacts);
    persistLocal(DELETED_KEY, state.deleted);
    renderList();
  } catch (err) {
    console.warn("API load failed:", err.message);
  }
}

async function apiSyncNow() {
  if (!isApiLoggedIn()) return;
  try {
    await apiRequest("PUT", "/api/contacts", { contacts: state.contacts, deleted: state.deleted });
  } catch (err) {
    console.warn("API sync failed:", err.message);
  }
}

function scheduleApiSync() {
  if (!isApiLoggedIn()) return;
  clearTimeout(apiSyncTimer);
  apiSyncTimer = setTimeout(apiSyncNow, 1500);
}

// Auth modal wiring
const authModal      = document.querySelector("#authModal");
const authModalTitle = document.querySelector("#authModalTitle");
const authEmailInput = document.querySelector("#authEmail");
const authPassInput  = document.querySelector("#authPassword");
const authModalMsg   = document.querySelector("#authModalMessage");
const authSubmitBtn  = document.querySelector("#authSubmitBtn");
const authSwitchBtn  = document.querySelector("#authSwitchBtn");
const authLoggedInEl = document.querySelector("#authLoggedIn");
const authUserEmail  = document.querySelector("#authUserEmail");
const authBtn        = document.querySelector("#authBtn");

let authMode = "login"; // "login" | "signup"

function updateAuthUI() {
  if (isApiLoggedIn()) {
    authBtn.textContent = apiEmail() || "Account";
    authBtn.classList.add("synced");
  } else {
    authBtn.textContent = "Log in";
    authBtn.classList.remove("synced");
  }
}

function openAuthModal() {
  authModalMsg.textContent = "";
  authEmailInput.value = "";
  authPassInput.value = "";
  const loggedIn = isApiLoggedIn();
  authLoggedInEl.hidden = !loggedIn;
  document.querySelector("#authModal > .modal-box > label:nth-of-type(1)").hidden = loggedIn;
  document.querySelector("#authModal > .modal-box > label:nth-of-type(2)").hidden = loggedIn;
  authSubmitBtn.hidden = loggedIn;
  authSwitchBtn.hidden = loggedIn;
  if (loggedIn) {
    authUserEmail.textContent = apiEmail();
    authModalTitle.textContent = "Account";
  } else {
    authModalTitle.textContent = authMode === "login" ? "Log in" : "Sign up";
    authSubmitBtn.textContent  = authMode === "login" ? "Log in" : "Create account";
    authSwitchBtn.textContent  = authMode === "login" ? "No account? Sign up" : "Have an account? Log in";
  }
  authModal.hidden = false;
}

authBtn.addEventListener("click", openAuthModal);
document.querySelector("#authModalClose").addEventListener("click",  () => { authModal.hidden = true; });
document.querySelector("#authModalClose2").addEventListener("click", () => { authModal.hidden = true; });
authModal.addEventListener("click", e => { if (e.target === authModal) authModal.hidden = true; });

authSwitchBtn.addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  authModalMsg.textContent = "";
  authModalTitle.textContent = authMode === "login" ? "Log in" : "Sign up";
  authSubmitBtn.textContent  = authMode === "login" ? "Log in" : "Create account";
  authSwitchBtn.textContent  = authMode === "login" ? "No account? Sign up" : "Have an account? Log in";
});

authSubmitBtn.addEventListener("click", async () => {
  const email    = authEmailInput.value.trim();
  const password = authPassInput.value.trim();
  if (!email || !password) {
    authModalMsg.style.color = "var(--danger)";
    authModalMsg.textContent = "Enter your email and password.";
    return;
  }
  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = authMode === "login" ? "Logging in…" : "Creating account…";
  authModalMsg.style.color = "var(--muted)";
  authModalMsg.textContent = "Please wait…";
  try {
    const data = await apiRequest("POST", `/api/auth/${authMode}`, { email, password });
    localStorage.setItem(API_TOKEN_KEY, data.token);
    localStorage.setItem(API_EMAIL_KEY, data.email);
    // Push any locally saved cards to the new account, then load from server
    await apiSyncNow();
    await apiLoadContacts();
    updateAuthUI();
    authModal.hidden = true;
  } catch (err) {
    authModalMsg.style.color = "var(--danger)";
    authModalMsg.textContent = err.message;
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "login" ? "Log in" : "Create account";
  }
});

document.querySelector("#authLogoutBtn").addEventListener("click", () => {
  localStorage.removeItem(API_TOKEN_KEY);
  localStorage.removeItem(API_EMAIL_KEY);
  updateAuthUI();
  authModal.hidden = true;
});

// ── GitHub Gist sync ────────────────────────────────────────────────────────

const gistSyncBtn    = document.querySelector("#gistSyncBtn");
const gistModal      = document.querySelector("#gistModal");
const gistTokenInput = document.querySelector("#gistTokenInput");
const gistModalMsg   = document.querySelector("#gistModalMessage");
const gistConnectBtn = document.querySelector("#gistConnectBtn");
const gistDiscoBtn   = document.querySelector("#gistDisconnectBtn");
const gistModalClose = document.querySelector("#gistModalClose");
const savedEyebrow   = document.querySelector("#savedEyebrow");

function gistToken() { return localStorage.getItem(GIST_TOKEN_KEY) || ""; }
function gistId()    { return localStorage.getItem(GIST_ID_KEY) || ""; }
function isGistConnected() { return Boolean(gistToken() && gistId()); }

function updateGistUI() {
  if (isGistConnected()) {
    gistSyncBtn.textContent = "GitHub Synced ✓";
    gistSyncBtn.classList.add("synced");
    savedEyebrow.textContent = "Synced to GitHub";
    gistDiscoBtn.hidden = false;
  } else {
    gistSyncBtn.textContent = "Connect GitHub";
    gistSyncBtn.classList.remove("synced");
    savedEyebrow.textContent = "Saved locally";
    gistDiscoBtn.hidden = true;
  }
}

function gistHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };
}

async function fetchGistData() {
  const res = await fetch(`https://api.github.com/gists/${gistId()}`, {
    headers: gistHeaders(gistToken())
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const data = await res.json();
  const content = data.files?.[GIST_FILENAME]?.content;
  if (!content) return null;
  return JSON.parse(content);
}

async function pushToGist() {
  if (!isGistConnected()) return;
  const body = JSON.stringify({ contacts: state.contacts, deleted: state.deleted }, null, 2);
  const res = await fetch(`https://api.github.com/gists/${gistId()}`, {
    method: "PATCH",
    headers: gistHeaders(gistToken()),
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: body } } })
  });
  if (!res.ok) console.warn("Gist push failed:", res.status);
}

function scheduleGistPush() {
  if (!isGistConnected()) return;
  clearTimeout(gistPushTimer);
  gistPushTimer = setTimeout(pushToGist, 1500);
}

async function pullAndMergeGist() {
  if (!isGistConnected()) return;
  try {
    const remote = await fetchGistData();
    if (!remote) return;

    const remoteContacts = (Array.isArray(remote.contacts) ? remote.contacts : []).map(normalizeContact).filter(hasMeaningfulContactData);
    const remoteDeleted  = (Array.isArray(remote.deleted)  ? remote.deleted  : []).map(normalizeContact).filter(hasMeaningfulContactData);

    // Merge: keep any local card not present remotely, remote wins for shared IDs
    const remoteIds = new Set(remoteContacts.map(c => c.id));
    const localOnly = state.contacts.filter(c => !remoteIds.has(c.id));
    state.contacts = [...remoteContacts, ...localOnly];
    state.deleted  = remoteDeleted;

    persistLocal(STORAGE_KEY, state.contacts);
    persistLocal(DELETED_KEY, state.deleted);
    renderList();
  } catch (err) {
    console.warn("Gist pull failed:", err.message);
  }
}

async function createGistAndConnect(token) {
  const body = JSON.stringify({ contacts: state.contacts, deleted: state.deleted }, null, 2);
  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: gistHeaders(token),
    body: JSON.stringify({
      description: "Contact Saver – contact cards backup",
      public: false,
      files: { [GIST_FILENAME]: { content: body } }
    })
  });
  if (res.status === 401) throw new Error("Invalid token. Make sure you copied it fully and it has the 'gist' scope.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status}. Check the token has 'gist' scope.`);
  const data = await res.json();
  return data.id;
}

// Modal open/close
gistSyncBtn.addEventListener("click", () => {
  gistModalMsg.style.color = "";
  gistModalMsg.textContent = isGistConnected() ? "You are connected. Your cards sync automatically." : "";
  gistTokenInput.value = "";
  gistModal.hidden = false;
});

gistModalClose.addEventListener("click", () => { gistModal.hidden = true; });
gistModal.addEventListener("click", e => { if (e.target === gistModal) gistModal.hidden = true; });

gistConnectBtn.addEventListener("click", async () => {
  const token = gistTokenInput.value.trim();
  if (!token) {
    gistModalMsg.style.color = "var(--danger)";
    gistModalMsg.textContent = "Paste your personal access token first.";
    return;
  }
  gistConnectBtn.disabled = true;
  gistConnectBtn.textContent = "Connecting…";
  gistModalMsg.style.color = "var(--muted)";
  gistModalMsg.textContent = "Creating a private Gist on your account…";
  try {
    const id = await createGistAndConnect(token);
    localStorage.setItem(GIST_TOKEN_KEY, token);
    localStorage.setItem(GIST_ID_KEY, id);
    gistTokenInput.value = "";
    gistModalMsg.style.color = "var(--success)";
    gistModalMsg.textContent = "Connected! Your cards are now saved to GitHub forever.";
    updateGistUI();
    setTimeout(() => { gistModal.hidden = true; }, 1800);
  } catch (err) {
    gistModalMsg.style.color = "var(--danger)";
    gistModalMsg.textContent = err.message;
  } finally {
    gistConnectBtn.disabled = false;
    gistConnectBtn.textContent = "Connect & Sync";
  }
});

gistDiscoBtn.addEventListener("click", () => {
  localStorage.removeItem(GIST_TOKEN_KEY);
  localStorage.removeItem(GIST_ID_KEY);
  updateGistUI();
  gistModalMsg.style.color = "var(--muted)";
  gistModalMsg.textContent = "Disconnected. Cards still saved locally.";
});

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  loadContacts();
  localStorage.removeItem("contactSaverQrLogo");
  setQrDesignState();
  fillForm();
  renderList();
  renderPreview();
  showView();
  updateGistUI();
  updateAuthUI();
  await pullAndMergeGist();
  await apiLoadContacts();
}

init();
