# 🐦 Manan — The Book Note Distiller

**Distill wisdom without slowing down your reading flow.**

Manan (Hindi for *reflection* or *contemplation*) is an AI-powered assistant designed for high-velocity readers. If you read a book every two days but struggle to find the time to take meaningful notes, Manan is your second brain.

---

## 🚀 The Problem & The Solution

**The Problem:** Taking notes while reading often doubles the time it takes to finish a book. It breaks the "flow state" and makes reading feel like a chore.

**The Solution:** Read at your natural pace. When finished, drop your EPUB or PDF into Manan. The app scans the book chapter-by-chapter, identifying direct quotes, key lessons, and deep insights. You simply click the nuggets you want to keep, and Manan builds a structured Markdown file for your permanent notes.

---

## ✨ Key Functionality

- **EPUB & PDF Support:** Full parsing of common digital book formats.
- **Chapter-by-Chapter Distillation:** Instead of a generic summary, Manan walks through the book section-by-section, mimicking a focused review.
- **Context-Aware Extraction:** Uses Google Gemini to distinguish between core content and "Front/Back Matter" (prefaces, indexes, etc.).
- **Interactive Drafting:** Click to collect. View your "Distilled Collection" in a side panel as you build your final summary.
- **Markdown Export:** One-click download of a polished `.md` file, ready for Obsidian, Notion, or Logseq.
- **Privacy First:** All book parsing and caching happen in your browser session. No databases, no tracking.
- **Deep Search:** Looking for that one specific fact? Use the built-in Deep Search to hunt through the book's context using AI.

---

## 🛠️ Installation & Deployment

Manan is a lightweight frontend application. You can host it on any VPS (like Racknerd) or your local machine.

### 🐳 Docker (Recommended)

To run Manan in a container:

1. **Build the image:**
   ```bash
   docker build -t manan-app .
   ```
2. **Run the container:**
   ```bash
   docker run -d -p 8080:80 --name manan manan-app
   ```

### 💻 Manual Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/manan.git
   cd manan
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the dev server:**
   ```bash
   npm run dev
   ```

---

## 🧠 The "Vibe Coding" Story

This application was **entirely vibe coded using Google Gemini**. 

Every line of code, every UI decision, and every architectural choice was generated through high-level conversational intent. It represents a shift in how software is built: focusing on the *problem* and the *aesthetic* rather than the syntax.

- **Primary Intelligence:** `gemini-3-pro-preview`
- **Vision & Branding:** AI-assisted design using brand colors derived from the Blue-footed Booby logo.
- **Human-in-the-loop:** Developed by describing the desired reading experience and iterating in real-time.

---

## 📜 Open Source Licensing

Manan is released under the **MIT License**. You are free to fork, modify, and distribute this software as you see fit.

---

## 🤝 Contributing

Have an idea to make Manan better? 
- Open an issue for feature requests.
- Submit a PR with your "vibe-coded" improvements.
- Share your distilled reading notes!

---

*“To read is to fly; to reflect is to land.” — Manan*