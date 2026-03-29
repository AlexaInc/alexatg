

## ## Telegram Bubble Component Plan (`plan.md`)

### ### 1. Bubble Anatomy (HTML Structure)
Each bubble will be a self-contained `div` with a specific data-attribute to define its origin (Inbound vs. Outbound).

* **Wrapper:** `.chat-bubble-container` (Handles alignment).
* **Avatar:** `.bubble-pp` (Optional, hidden for consecutive messages).
* **Content Area:** * `.bubble-name`: Sender identity.
    * `.bubble-content`: The core message (Supports `innerHTML`).
    * `.bubble-meta`: Timestamp and "Read" ticks.
* **Special Class:** `.is-sticker` (Removes background/shadow for transparent sticker buffers).

### ### 2. Styling Logic (CSS)
* **Tail Generation:** Use CSS `clip-path` or `::after` borders to create the signature "beak" at the bottom corner of the bubble.
* **Dynamic Sizing:** `max-width: 70%` for text; fixed dimensions for stickers to prevent layout shift.
* **Buffer Handling:** * **Text/HTML:** Standard padding and background color.
    * **Stickers/Animated Emojis:** `background: transparent;` and `box-shadow: none;` to let the buffer-rendered image float.

---

### ### 3. Functional Logic (JavaScript)

#### **A. The Message Factory**
A function `createBubble(config)` will generate the DOM elements.
```javascript
const config = {
  name: "User Name",
  pp: "avatar_url or buffer",
  message: "<b>Hello</b> world!", // HTML Input
  type: "text", // or 'sticker'
  buffer: null, // Binary data for stickers/animated emojis
  isOwner: true // Right-aligned if true
};
```

#### **B. Buffer to Media Pipeline**
To support **Stickers** and **Animated Emojis** via buffers:
1.  **Conversion:** Use `URL.createObjectURL(new Blob([buffer]))`.
2.  **Rendering:** * If `type === 'sticker'`, render an `<img>` inside the bubble.
    * If `type === 'animated-emoji'`, render a smaller, high-res `<img>` or a `<canvas>` if the buffer contains raw frame data.

#### **C. Multi-Message Grouping**
Logic to check the `userId` of the previous bubble. If they match:
* Add `.grouped` class.
* Hide `.bubble-pp` and `.bubble-name`.
* Flatten the corner of the bubble tail for a "stacked" look.

---

### ### 4. Technical Constraints
* **Sanitization:** Since you want HTML input support, the JS will include a light regex pass to ensure only safe tags (like `<b>`, `<i>`, `<a>`) are rendered.
* **Performance:** `URL.revokeObjectURL()` will be called after the element is removed from the DOM to prevent memory leaks from the buffers.

---

### ### 5. Next Steps
1.  **Skeleton:** Define the CSS variables for Telegram’s color palette.
2.  **Logic:** Build the `bufferToImage` helper function.
3.  **Export:** Create a single reusable CSS file and a JS class `TelegramBubble`.

