const STORAGE_KEY = "contactSaverCards";
const QR_VERSION = "phone-labels-5";

const state = {
  contacts: [],
  selected: null
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
const previewCard = document.querySelector("#previewCard");
const downloadVcf = document.querySelector("#downloadVcf");
let qrLibraryPromise = null;

function clean(value) {
  return String(value || "").trim();
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

function initials(name) {
  return clean(name).split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("") || "CS";
}

function titleLine(contact) {
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
  const match = text.match(/^(\+\d{1,4})[\s-]*(.*)$/);
  if (!match) return { label: "Mobile", countryCode: "+91", number: text };
  return { label: "Mobile", countryCode: match[1], number: match[2] };
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

function vcardPhoneType(label) {
  const value = clean(label).toLowerCase();
  if (value.includes("landline") || value.includes("office") || value.includes("work") || value.includes("department") || value.includes("sales") || value.includes("marketing")) {
    return "WORK,VOICE";
  }
  if (value.includes("home") || value.includes("personal")) return "HOME,VOICE";
  return "CELL";
}

function normalizeContact(contact) {
  return {
    id: contact.id || crypto.randomUUID(),
    fullName: clean(contact.fullName),
    role: clean(contact.role),
    company: clean(contact.company),
    phones: normalizePhoneEntries(contact),
    email: clean(contact.email).toLowerCase(),
    website: clean(contact.website),
    address: clean(contact.address),
    updatedAt: contact.updatedAt || new Date().toISOString()
  };
}

function vcardFor(contact) {
  const names = clean(contact.fullName).split(/\s+/).filter(Boolean);
  const lastName = names.length > 1 ? names[names.length - 1] : "";
  const firstName = names.length > 1 ? names.slice(0, -1).join(" ") : contact.fullName;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
    `FN:${escapeVCard(contact.fullName)}`
  ];

  if (contact.company) lines.push(`ORG:${escapeVCard(contact.company)}`);
  if (contact.role) lines.push(`TITLE:${escapeVCard(contact.role)}`);
  normalizePhoneEntries(contact).forEach((entry, index) => {
    const phone = fullPhone(entry);
    if (!phone) return;
    const item = `item${index + 1}`;
    const label = clean(entry.label) || "Mobile";
    lines.push(`${item}.TEL;TYPE=${vcardPhoneType(label)}:${escapeVCard(phone)}`);
    lines.push(`${item}.X-ABLabel:${escapeVCard(label)}`);
  });
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(contact.email)}`);
  if (contact.website) lines.push(`URL:${escapeVCard(contact.website)}`);
  if (contact.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(contact.address)};;;;`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function saveContacts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.contacts));
}

function loadContacts() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  const seed = [{
    id: crypto.randomUUID(),
    fullName: "Aanya Shah",
    role: "Founder",
    company: "Brill Brains Consulting",
    phones: [{ label: "Mobile", countryCode: "+91", number: "98765 43210" }],
    email: "aanya@brillbrains.example",
    website: "https://brillbrains.example",
    address: "Mumbai, Maharashtra, India",
    updatedAt: new Date().toISOString()
  }];

  state.contacts = (Array.isArray(saved) && saved.length ? saved : seed)
    .map(normalizeContact)
    .filter(contact => contact.fullName);
  state.selected = state.contacts[0] || null;
  saveContacts();
}

function phoneValuesFromForm() {
  return [...form.querySelectorAll(".phone-row")]
    .map((row, index) => normalizePhoneEntry({
      label: row.querySelector('input[name="phoneLabels"]')?.value || (index === 0 ? "Mobile" : ""),
      countryCode: row.querySelector('input[name="countryCodes"]')?.value || "+91",
      number: row.querySelector('input[name="phoneNumbers"]')?.value || ""
    }, index))
    .filter(entry => fullPhone(entry));
}

function addIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
}

function deleteIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14M10 11v5M14 11v5"/></svg>';
}

function phoneRowHtml(entry = {}, index = 0, rowCount = 1) {
  const phone = normalizePhoneEntry(entry, index);
  const labelPlaceholder = index === 0 ? "Mobile" : "Landline, Sales department, Marketing";
  const labelValue = phone.label || (index === 0 ? "Mobile" : "");
  return `
    <div class="phone-row">
      <input class="phone-label-input" name="phoneLabels" value="${escapeHtml(labelValue)}" placeholder="${escapeHtml(labelPlaceholder)}" aria-label="Phone label">
      <input class="country-code-input" name="countryCodes" value="${escapeHtml(phone.countryCode)}" placeholder="+91" list="countryCodes" aria-label="Country code">
      <input class="phone-number-input" name="phoneNumbers" value="${escapeHtml(phone.number)}" placeholder="9820942844" autocomplete="tel" aria-label="Phone number">
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
  form.id.value = contact.id || "";
  form.fullName.value = contact.fullName || "";
  form.role.value = contact.role || "";
  form.company.value = contact.company || "";
  form.email.value = contact.email || "";
  form.website.value = contact.website || "";
  form.address.value = contact.address || "";
  renderPhoneFields(normalizePhoneEntries(contact));
}

function contactFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = state.contacts.find(contact => contact.id === data.id);
  const fullName = clean(data.fullName);
  if (!fullName) throw new Error("Full name is required");

  return {
    id: existing?.id || crypto.randomUUID(),
    fullName,
    role: clean(data.role),
    company: clean(data.company),
    phones: phoneValuesFromForm(),
    email: clean(data.email).toLowerCase(),
    website: clean(data.website),
    address: clean(data.address),
    updatedAt: new Date().toISOString()
  };
}

function updateVcfLink(contact) {
  const blob = new Blob([vcardFor(contact)], { type: "text/vcard;charset=utf-8" });
  if (downloadVcf.dataset.url) URL.revokeObjectURL(downloadVcf.dataset.url);
  const url = URL.createObjectURL(blob);
  downloadVcf.dataset.url = url;
  downloadVcf.href = url;
  downloadVcf.download = `${fileSafeName(contact.fullName)}.vcf`;
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
  new QRious({
    element: canvas,
    value: vcardFor(contact),
    size,
    padding,
    level: "M",
    foreground: "#000000",
    background: "#ffffff"
  });
}

function findQrBounds(canvas) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (pixels[index] < 96 && pixels[index + 1] < 96 && pixels[index + 2] < 96) {
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

async function drawCenteredQr(canvas, contact, size, quietZone) {
  const source = document.createElement("canvas");
  await drawQr(source, contact, size - quietZone * 2, null);
  const bounds = findQrBounds(source);
  const context = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

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
}

async function renderQr(contact) {
  qrError.hidden = true;
  qrCanvas.hidden = false;
  try {
    await drawQr(qrCanvas, contact, 320, null);
  } catch (error) {
    qrCanvas.hidden = true;
    qrError.hidden = false;
    qrError.textContent = error.message;
  }
}

function phoneSummary(contact) {
  const phones = normalizePhoneEntries(contact).map(fullPhone).filter(Boolean);
  return phones.length ? phones.join(" / ") : "No phone added";
}

function phoneLabelSummary(contact) {
  return normalizePhoneEntries(contact)
    .filter(entry => fullPhone(entry))
    .map(entry => `${clean(entry.label) || "Mobile"}: ${fullPhone(entry)}`)
    .join(" / ") || "No phone added";
}

function renderPreview() {
  const contact = state.selected || state.contacts[0];
  if (!contact) {
    previewCard.innerHTML = `
      <div class="avatar">CS</div>
      <h3>Select a card</h3>
      <p>Create a contact to preview the QR details.</p>
    `;
    return;
  }

  previewCard.innerHTML = `
    <div class="avatar">${escapeHtml(initials(contact.fullName))}</div>
    <h3>${escapeHtml(contact.fullName)}</h3>
    <p>${escapeHtml(titleLine(contact) || contact.email || phoneSummary(contact))}</p>
    <p>${escapeHtml(phoneLabelSummary(contact))}</p>
  `;
  updateVcfLink(contact);
  renderQr(contact);
}

function renderList() {
  countEl.textContent = `${state.contacts.length} card${state.contacts.length === 1 ? "" : "s"}`;
  if (!state.contacts.length) {
    listEl.innerHTML = '<p class="muted">No cards yet.</p>';
    return;
  }

  listEl.innerHTML = state.contacts.map(contact => `
    <article class="contact-item" data-id="${escapeHtml(contact.id)}">
      <div class="contact-main">
        <div class="avatar">${escapeHtml(initials(contact.fullName))}</div>
        <div>
          <h3>${escapeHtml(contact.fullName)}</h3>
          <p>${escapeHtml(titleLine(contact) || contact.email || phoneSummary(contact))}</p>
          <p>${escapeHtml(phoneLabelSummary(contact))}</p>
        </div>
      </div>
      <div class="contact-actions">
        <button class="icon-button" type="button" data-action="select">Preview</button>
        <button class="icon-button" type="button" data-action="edit">Edit</button>
        <button class="icon-button danger" type="button" data-action="delete">Delete</button>
      </div>
    </article>
  `).join("");
}

function showView() {
  const showSaved = location.hash === "#saved";
  createView.hidden = showSaved;
  savedView.hidden = !showSaved;
  document.body.classList.toggle("saved-active", showSaved);
  if (showSaved) renderList();
}

function selectContact(contact) {
  state.selected = contact;
  renderPreview();
}

phoneFields.addEventListener("click", event => {
  const addButton = event.target.closest(".add-phone");
  if (addButton) {
    const nextIndex = phoneFields.querySelectorAll(".phone-row").length;
    phoneFields.insertAdjacentHTML("beforeend", phoneRowHtml({ label: "", countryCode: "+91", number: "" }, nextIndex, nextIndex + 1));
    phoneFields.querySelectorAll(".remove-phone").forEach(button => {
      button.disabled = false;
    });
    phoneFields.querySelector(".phone-row:last-child .phone-label-input")?.focus();
    return;
  }

  const button = event.target.closest(".remove-phone");
  if (!button) return;
  button.closest(".phone-row")?.remove();
  const rows = phoneFields.querySelectorAll(".phone-row");
  if (!rows.length) renderPhoneFields([{ label: "Mobile", countryCode: "+91", number: "" }]);
  if (rows.length === 1) rows[0].querySelector(".remove-phone").disabled = true;
});

if (addPhoneButton) {
  addPhoneButton.addEventListener("click", () => {
    phoneFields.insertAdjacentHTML("beforeend", phoneRowHtml({ label: "", countryCode: "+91", number: "" }, phoneFields.querySelectorAll(".phone-row").length, 2));
    phoneFields.querySelector(".phone-row:last-child .phone-label-input")?.focus();
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();
  messageEl.style.color = "var(--success)";
  try {
    const contact = contactFromForm();
    const existing = state.contacts.some(item => item.id === contact.id);
    state.contacts = existing
      ? state.contacts.map(item => item.id === contact.id ? contact : item)
      : [contact, ...state.contacts];
    state.selected = contact;
    saveContacts();
    fillForm(contact);
    renderList();
    renderPreview();
    messageEl.textContent = "Saved. QR updated.";
  } catch (error) {
    messageEl.style.color = "var(--danger)";
    messageEl.textContent = error.message;
  }
});

document.querySelector("#resetForm").addEventListener("click", () => {
  state.selected = null;
  fillForm();
  messageEl.textContent = "";
  renderPreview();
});

listEl.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = event.target.closest(".contact-item");
  const contact = state.contacts.find(candidate => candidate.id === item.dataset.id);
  if (!contact) return;

  if (button.dataset.action === "select") {
    selectContact(contact);
    location.hash = "";
  }
  if (button.dataset.action === "edit") {
    selectContact(contact);
    fillForm(contact);
    location.hash = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (button.dataset.action === "delete") {
    state.contacts = state.contacts.filter(candidate => candidate.id !== contact.id);
    if (state.selected?.id === contact.id) state.selected = state.contacts[0] || null;
    saveContacts();
    renderList();
    renderPreview();
  }
});

document.querySelector("#downloadQr").addEventListener("click", async () => {
  const contact = state.selected || state.contacts[0];
  if (!contact) return;
  try {
    const canvas = document.createElement("canvas");
    await drawCenteredQr(canvas, contact, 1800, 126);
    const link = document.createElement("a");
    link.download = `${downloadSafeName(contact.fullName)}_Contact-Qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    qrError.hidden = false;
    qrError.textContent = error.message;
  }
});

window.addEventListener("hashchange", showView);

loadContacts();
fillForm(state.selected);
renderList();
renderPreview();
showView();
