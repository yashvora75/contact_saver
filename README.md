# Contact Saver

A static GitHub Pages prototype for creating a digital contact card and QR code.

## Live URL

After GitHub Pages is enabled for the repository, open:

https://yashvora75.github.io/contact_saver/

## How it works

GitHub Pages cannot run a Node server or database. This version runs fully in the browser:

- Create/edit a client contact card.
- Generate a **Direct contact QR** containing the vCard data.
- Generate a **Digital card QR** that opens a shareable card page.
- Save contacts locally in the browser with `localStorage`.

Phones do not allow a QR scan to silently write into Contacts without user confirmation. The reliable flow is that the phone opens a contact preview and the user taps **Add Contact**.

## Local preview

```bash
npm start
```

Open http://localhost:5173
