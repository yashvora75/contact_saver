# Contact Saver

A static GitHub Pages app for creating contact-save QR codes.

Live app:

https://yashvora75.github.io/contact_saver/

## What it does

- Creates a vCard QR code that opens a contact preview on iPhone and Android.
- Supports multiple phone numbers in the same QR.
- Saves cards locally in the browser.
- Shows saved cards on a separate `#saved` page.
- Downloads an HD PNG QR image and a `.vcf` file.

Phones require the user to confirm adding a contact. iOS and Android do not allow a QR scan to silently save into Contacts.

## Local preview

```bash
npm start
```

Open http://localhost:5173
