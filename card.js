function clean(value) {
  return String(value || "").trim();
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

function decodeCard(hash) {
  const encoded = hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function initials(name) {
  return clean(name).split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("") || "CS";
}

function titleLine(contact) {
  return [contact.role, contact.company].filter(Boolean).join(" at ");
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

function row(label, value, href) {
  if (!value) return "";
  const body = href ? `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>` : escapeHtml(value);
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${body}</strong></div>`;
}

function saveUrl(contact) {
  const blob = new Blob([vcardFor(contact)], { type: "text/vcard;charset=utf-8" });
  return URL.createObjectURL(blob);
}

const card = document.querySelector("#publicCard");

try {
  const contact = decodeCard(location.hash);
  const color = /^#[0-9a-fA-F]{6}$/.test(contact.brandColor || "") ? contact.brandColor : "#1266F1";
  const url = saveUrl(contact);
  const fileName = `${contact.slug || "contact"}.vcf`;
  card.innerHTML = `
    <div class="public-hero" style="background:${escapeHtml(color)}">
      <div class="avatar">${escapeHtml(initials(contact.fullName))}</div>
      <h1>${escapeHtml(contact.fullName)}</h1>
      <p>${escapeHtml(titleLine(contact) || "Digital contact card")}</p>
    </div>
    <div class="public-body">
      ${contact.notes ? `<p>${escapeHtml(contact.notes)}</p>` : ""}
      <div class="detail-list">
        ${row("Phone", contact.phone, contact.phone ? `tel:${contact.phone}` : "")}
        ${row("Email", contact.email, contact.email ? `mailto:${contact.email}` : "")}
        ${row("Website", contact.website, contact.website)}
        ${row("Address", contact.address)}
      </div>
      <div class="card-actions">
        <a class="primary-button" id="saveContact" href="${url}" download="${escapeHtml(fileName)}">Save Contact</a>
        ${contact.website ? `<a class="ghost-button" href="${escapeHtml(contact.website)}">Website</a>` : ""}
      </div>
    </div>
  `;
  if (new URLSearchParams(location.search).get("save") === "1") {
    setTimeout(() => document.querySelector("#saveContact")?.click(), 700);
  }
} catch (error) {
  card.innerHTML = `<div class="loader">Card link is missing or invalid.</div>`;
}
