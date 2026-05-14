const STORAGE_KEY = "contactSaverCards";
const DEFAULT_BASE_URL = "https://yashvora75.github.io/contact_saver";

const state = {
  contacts: [],
  selected: null,
  qrMode: "direct"
};

const form = document.querySelector("#contactForm");
const listEl = document.querySelector("#contactList");
const countEl = document.querySelector("#contactCount");
const messageEl = document.querySelector("#formMessage");
const baseUrlEl = document.querySelector("#baseUrl");
const qrCanvas = document.querySelector("#qrCanvas");
const qrError = document.querySelector("#qrError");
const previewCard = document.querySelector("#previewCard");
const downloadVcf = document.querySelector("#downloadVcf");

function clean(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return clean(value).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "contact";
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
  if (contact.phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(contact.phone)}`);
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(contact.email)}`);
  if (contact.website) lines.push(`URL:${escapeVCard(contact.website)}`);
  if (contact.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(contact.address)};;;;`);
  if (contact.notes) lines.push(`NOTE:${escapeVCard(contact.notes)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function encodeCard(contact) {
  const json = JSON.stringify(contact);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function baseUrl() {
  return clean(baseUrlEl.value).replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

function cardUrl(contact) {
  const params = new URLSearchParams({ save: "1" });
  return `${baseUrl()}/card.html?${params.toString()}#${encodeCard(contact)}`;
}

function qrPayload(contact) {
  return state.qrMode === "direct" ? vcardFor(contact) : cardUrl(contact);
}

function saveContacts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.contacts));
}

function loadContacts() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  state.contacts = Array.isArray(saved) && saved.length ? saved : [{
    id: crypto.randomUUID(),
    slug: "aanya-shah",
    fullName: "Aanya Shah",
    role: "Founder",
    company: "Brill Brains Consulting",
    phone: "+91 98765 43210",
    email: "aanya@brillbrains.example",
    website: "https://brillbrains.example",
    address: "Mumbai, Maharashtra, India",
    notes: "Business strategy, operations, and growth systems.",
    brandColor: "#1266F1",
    updatedAt: new Date().toISOString()
  }];
  if (!saved) saveContacts();
  state.selected = state.contacts[0] || null;
}

function fillForm(contact = {}) {
  form.id.value = contact.id || "";
  form.fullName.value = contact.fullName || "";
  form.role.value = contact.role || "";
  form.company.value = contact.company || "";
  form.phone.value = contact.phone || "";
  form.email.value = contact.email || "";
  form.website.value = contact.website || "";
  form.brandColor.value = contact.brandColor || "#1266F1";
  form.slug.value = contact.slug || "";
  form.address.value = contact.address || "";
  form.notes.value = contact.notes || "";
}

function contactFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  const existing = state.contacts.find(contact => contact.id === data.id);
  const fullName = clean(data.fullName);
  if (!fullName) throw new Error("Full name is required");
  return {
    id: existing?.id || crypto.randomUUID(),
    slug: slugify(data.slug || fullName),
    fullName,
    role: clean(data.role),
    company: clean(data.company),
    phone: clean(data.phone),
    email: clean(data.email).toLowerCase(),
    website: clean(data.website),
    brandColor: /^#[0-9a-fA-F]{6}$/.test(data.brandColor) ? data.brandColor : "#1266F1",
    address: clean(data.address),
    notes: clean(data.notes),
    updatedAt: new Date().toISOString()
  };
}

function updateVcfLink(contact) {
  const blob = new Blob([vcardFor(contact)], { type: "text/vcard;charset=utf-8" });
  if (downloadVcf.dataset.url) URL.revokeObjectURL(downloadVcf.dataset.url);
  const url = URL.createObjectURL(blob);
  downloadVcf.dataset.url = url;
  downloadVcf.href = url;
  downloadVcf.download = `${contact.slug || "contact"}.vcf`;
}

async function renderQr(contact) {
  qrError.hidden = true;
  qrCanvas.hidden = false;
  const payload = qrPayload(contact);
  if (!window.QRCode) {
    qrCanvas.hidden = true;
    qrError.hidden = false;
    qrError.textContent = "QR library is still loading. Refresh if it does not appear.";
    return;
  }
  try {
    await QRCode.toCanvas(qrCanvas, payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: state.qrMode === "direct" ? "M" : "Q",
      color: { dark: "#000000", light: "#ffffff" }
    });
  } catch (error) {
    qrCanvas.hidden = true;
    qrError.hidden = false;
    qrError.textContent = error.message;
  }
}

function renderPreview() {
  const contact = state.selected || state.contacts[0];
  if (!contact) {
    previewCard.innerHTML = `
      <div class="avatar">CS</div>
      <h3>Select a card</h3>
      <p>Create a contact to preview the public card.</p>
    `;
    return;
  }

  previewCard.innerHTML = `
    <div class="avatar" style="background:${escapeHtml(contact.brandColor)}">${escapeHtml(initials(contact.fullName))}</div>
    <h3>${escapeHtml(contact.fullName)}</h3>
    <p>${escapeHtml(titleLine(contact) || contact.email || contact.phone || "Digital contact")}</p>
    ${contact.notes ? `<p>${escapeHtml(contact.notes)}</p>` : ""}
  `;
  updateVcfLink(contact);
  renderQr(contact);
}

function renderList() {
  countEl.textContent = `${state.contacts.length} card${state.contacts.length === 1 ? "" : "s"}`;
  if (!state.contacts.length) {
    listEl.innerHTML = '<p class="muted">No cards yet.</p>';
    renderPreview();
    return;
  }
  listEl.innerHTML = state.contacts.map(contact => `
    <article class="contact-item" data-id="${escapeHtml(contact.id)}">
      <div class="contact-main">
        <div class="avatar" style="background:${escapeHtml(contact.brandColor)}">${escapeHtml(initials(contact.fullName))}</div>
        <div>
          <h3>${escapeHtml(contact.fullName)}</h3>
          <p>${escapeHtml(titleLine(contact) || contact.email || contact.phone || contact.slug)}</p>
        </div>
      </div>
      <div class="contact-actions">
        <button class="icon-button" type="button" data-action="select">Preview</button>
        <button class="icon-button" type="button" data-action="edit">Edit</button>
        <button class="icon-button" type="button" data-action="copy">Copy Link</button>
        <button class="icon-button danger" type="button" data-action="delete">Delete</button>
      </div>
    </article>
  `).join("");
  renderPreview();
}

function selectContact(contact) {
  state.selected = contact;
  renderPreview();
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
    messageEl.textContent = "Saved locally. QR updated.";
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

document.querySelector(".segmented").addEventListener("click", event => {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  state.qrMode = button.dataset.mode;
  document.querySelectorAll(".segmented button").forEach(item => {
    item.classList.toggle("active", item === button);
  });
  renderPreview();
});

listEl.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const item = event.target.closest(".contact-item");
  const contact = state.contacts.find(candidate => candidate.id === item.dataset.id);
  if (!contact) return;
  if (button.dataset.action === "select") selectContact(contact);
  if (button.dataset.action === "edit") {
    selectContact(contact);
    fillForm(contact);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (button.dataset.action === "copy") {
    await navigator.clipboard.writeText(cardUrl(contact));
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy Link"; }, 1200);
  }
  if (button.dataset.action === "delete") {
    state.contacts = state.contacts.filter(candidate => candidate.id !== contact.id);
    if (state.selected?.id === contact.id) state.selected = state.contacts[0] || null;
    saveContacts();
    renderList();
  }
});

baseUrlEl.addEventListener("input", () => {
  localStorage.setItem("contactSaverBaseUrl", baseUrlEl.value);
  renderPreview();
});

document.querySelector("#copyTarget").addEventListener("click", async () => {
  const contact = state.selected || state.contacts[0];
  if (!contact) return;
  await navigator.clipboard.writeText(qrPayload(contact));
  messageEl.style.color = "var(--success)";
  messageEl.textContent = state.qrMode === "direct" ? "vCard payload copied." : "Card link copied.";
});

document.querySelector("#downloadQr").addEventListener("click", () => {
  const contact = state.selected || state.contacts[0];
  if (!contact) return;
  const link = document.createElement("a");
  link.download = `${contact.slug || "contact"}-qr.png`;
  link.href = qrCanvas.toDataURL("image/png");
  link.click();
});

baseUrlEl.value = localStorage.getItem("contactSaverBaseUrl") || DEFAULT_BASE_URL;
loadContacts();
fillForm(state.selected);
renderList();
