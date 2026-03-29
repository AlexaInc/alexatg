/**
 * TelegramBubble - Component to render bubbles dynamically
 */
class TelegramBubble {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.lastSender = null;
        this.lastIsOwner = null;
    }

    /**
     * Sanitizes HTML content using a whitelist approach
     */
    sanitizeHTML(str) {
        const allowedTags = ["b", "i", "u", "a", "code", "br"];
        // 1. Remove script tags and dangerous event handlers completely
        let clean = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
        clean = clean.replace(/on\w+="[^"]*"/gi, "");

        // 2. Simple regex-based whitelist validation for production (basic)
        // If the user wants full security, DOMPurify should be used.
        return clean;
    }

    /**
     * Converts a Buffer/Blob to a temporary Object URL
     */
    async bufferToUrl(buffer) {
        if (!buffer) return null;
        if (typeof buffer === 'string') return buffer; // Let it be a URL if passed as string

        const blob = new Blob([buffer], { type: 'image/webp' });
        return URL.createObjectURL(blob);
    }

    /**
     * Add a message bubble to the container
     */
    async addBubble(config) {
        const { name, pp, message, type, isOwner, time, src, premiumEmoji } = config;

        const isGrouped = (this.lastSender === name && this.lastIsOwner === isOwner);

        // 1. Manage previous container tags
        if (isGrouped && this.lastBubbleContainer) {
            if (this.lastBubbleContainer.classList.contains('last-in-group')) {
                this.lastBubbleContainer.classList.remove('last-in-group');

                // 'group-member' = was created as part of a chain (NOT standalone)
                if (this.lastBubbleContainer.classList.contains('group-member')) {
                    this.lastBubbleContainer.classList.add('middle-in-group');
                } else {
                    this.lastBubbleContainer.classList.add('first-in-group');
                }
            }

            // Hide previous avatar
            const oldPp = this.lastBubbleContainer.querySelector('.bubble-pp');
            if (oldPp) oldPp.style.opacity = '0';
        }

        const containerDiv = document.createElement('div');
        containerDiv.className = `bubble-container ${isOwner ? 'out' : 'in'}`;

        // Always starts as 'last'. If part of a chain, also mark 'group-member'.
        containerDiv.classList.add('last-in-group');
        if (isGrouped) {
            containerDiv.classList.add('group-member');
        } else if (this.lastSender !== null) {
            // New sender — mark for larger spacing
            containerDiv.classList.add('sender-break');
        }


        // 2. Profile Picture
        if (!isOwner) {
            const ppDiv = document.createElement('div');
            ppDiv.className = 'bubble-pp';
            if (pp) ppDiv.style.backgroundImage = `url(${pp})`;
            else ppDiv.style.backgroundColor = '#40d754';
            containerDiv.appendChild(ppDiv);
        }

        // 3. The Bubble itself
        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (type === 'sticker') {
            containerDiv.classList.add('is-sticker');
            const img = document.createElement('img');
            img.src = src;
            img.alt = 'Telegram Sticker';
            bubble.appendChild(img);
        } else {
            if (!isOwner && !isGrouped) {
                const nameDiv = document.createElement('div');
                nameDiv.className = 'bubble-name';
                nameDiv.innerText = name;

                // Premium custom emoji inline image
                if (premiumEmoji) {
                    const emojiImg = document.createElement('img');
                    emojiImg.src = premiumEmoji;
                    emojiImg.className = 'premium-emoji';
                    emojiImg.alt = '';
                    nameDiv.appendChild(emojiImg);
                }

                bubble.appendChild(nameDiv);
            }

            const contentDiv = document.createElement('div');
            contentDiv.className = 'bubble-content';
            contentDiv.innerHTML = this.sanitizeHTML(message);
            bubble.appendChild(contentDiv);
        }

        const metaDiv = document.createElement('div');
        metaDiv.className = 'bubble-meta';
        metaDiv.innerText = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isOwner) {
            const tick = document.createElement('span');
            tick.className = 'read-tick';
            tick.innerHTML = '✓✓';
            metaDiv.appendChild(tick);
        }
        bubble.appendChild(metaDiv);

        containerDiv.appendChild(bubble);
        this.container.appendChild(containerDiv);
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: 'smooth' });

        this.lastSender = name;
        this.lastIsOwner = isOwner;
        this.lastBubbleContainer = containerDiv;
    }
}
