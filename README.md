# Timatalva: Faroese Schedule Companion for WebUntis
<img width="1113" height="586" alt="cover" src="https://github.com/user-attachments/assets/54515f6a-b9e1-4c00-9999-86c30d681fdd" />

---

**Timatalva** is a lightweight desktop app built with Electron that fetches and displays school schedules from [WebUntis](https://webuntis.com/), optimized for students and teachers in the Faroe Islands.

This project was created to remove friction when checking your class timetable, with thoughtful features like:

- ✅ Offline-first interface
- 🔔 Smart lesson reminders (5 minutes before start)
- 🔕 Notification toggle with persistent state
- 🛡️ Geolocation and tracking disabled by default
- 🧠 Faroese language & UX awareness

---

## 📦 Features

- View your daily class schedule pulled from WebUntis
- Notifications before lessons (can be disabled)
- Class selection is remembered
- Local-only storage (no cloud, no user data collected)
- Minimal CPU/network usage with randomized fetch intervals
- One-click refresh
- Works on Windows (Linux/macOS in theory)

---

## 🚀 Getting Started

### Requirements
- Node.js
- npm

### Installation
```bash
git clone https://github.com/YOUR_USERNAME/timatalva.git
cd timatalva
npm install
npm start
```

---

## 🛠 Development

The main logic lives in:
- `main.js` - handles window, fetch logic, toasts, storage
- `renderer.js` - handles UI interactions
- `preload.cjs` - bridges Electron IPC securely

To build your own `.exe` (Windows):
```bash
npm run build
```
Make sure you’ve installed `electron-builder`.

---

## 🧾 License

This project is licensed under the **MIT License**. See `LICENSE` for details.

---

## 🤝 Acknowledgements

- WebUntis for powering the backend
- OpenAI for code support
- Faroese students and peers for testing & feedback

---

## 🔐 Privacy Statement

This app does not:
- Collect or transmit any user data
- Use any analytics or tracking
- Access geolocation, microphone, or camera

Everything is stored locally, and you can inspect the code yourself.

---

## 📸 Screenshots
<img width="173" height="698" alt="image" src="https://github.com/user-attachments/assets/393f6334-35b5-494d-b678-d551d0d3e1a9" />

---

## 🧠 Want to Contribute?
Pull requests are welcome. Feel free to fork and improve.

---

### Eystein C. 2025

