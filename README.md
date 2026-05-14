# Contact Saver

A static GitHub Pages app for creating contact-save QR codes.

Live app:

https://yashvora75.github.io/contact_saver/

## What it does

- Creates a vCard QR code that opens a contact preview on iPhone and Android.
- Supports multiple phone numbers with custom labels and country codes in the same QR.
- Autosaves cards locally in the browser while typing.
- Supports local contact photos in saved cards and previews.
- Shows saved cards on a separate `#saved` page.
- Keeps deleted cards on a separate `#deleted` page with restore/permanent delete actions.
- Downloads a centered HD PNG QR image and a `.vcf` file.

Phones require the user to confirm adding a contact. iOS and Android do not allow a QR scan to silently save into Contacts.

## Local preview

```bash
npm start
```

Open http://localhost:5173
