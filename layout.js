class WordWrapLayouter {
    constructor(fontManifestRegular, fontManifestBold = null, width = 2970) {
        this.fonts = {
            regular: fontManifestRegular,
            bold: fontManifestBold || fontManifestRegular
        };
        this.width = width;
    }

    layout(text) {
        const layoutRun = new LayoutRun(this.fonts, this.width, text);
        return layoutRun.layoutAll();
    }
}

class LayoutRun {
    constructor(fonts, width, text) {
        this.fonts = fonts;
        this.width = width;
        this.text = text;

        this.style = "regular";
        this.scale = 1.0;

        this.elements = [];
        this.currentElement = "";
        this.currentLineLength = 0;
        this.currentElementLength = 0;
        this.done = false;
    }

    charWidth(char) {
        const charCode = char.codePointAt(0);
        const glyphAddress = this.fonts[this.style].header[charCode];
        const glyph = this.fonts[this.style].glyphs[glyphAddress];
        if(glyph == undefined) {
            console.warn(`could not find char: ${char}, code point: ${charCode}`);
        }

        return glyph.frameWidth * this.scale;
    }

    layoutAll() {
        if (this.done) throw new Error("Tried to reuse LayoutRun");

        this.text.split(/(?=@.)/).forEach((e) => {
            if (e.startsWith("@")) {
                const tag = e.slice(0, 2);
                const content = e.slice(2);

                switch (tag) {
                    case "@k":
                    case "@>":
                    case "@[":
                    case "@]":
                    case "@{":
                    case "@}":
                    case "@|":
                    case "@y":
                    case "@e":
                    case "@t":
                    case "@-":
                    // Tags whose content should be processed for potential line breaks.

                    // Some of these tags cause style changes that need to be tracked:
                    if(tag === "@{") this.style = "bold";
                    if(tag === "@}") this.style = "regular";

                    this.appendRaw(tag);
                    this.appendChars(content);
                    break;

                    case "@b":
                    // Tags with content not requiring line breaks or line-length tracking
                    this.appendRaw(tag);
                    this.appendRaw(content);
                    break;

                    case "@<":
                    // Tags with content that should not have line breaks but counts for length
                    this.appendRaw(tag);
                    this.appendChars(content, true); // `no_break` = true
                    break;

                    case "@v":
                    case "@w":
                    case "@o":
                    case "@a":
                    case "@z":
                    case "@c":
                    case "@s":
                    const [parameter, ...tail] = content.split(".");
                    const text = tail.join(".");
                    if (tag === "@z") {
                        // Adjust the scale for font size tags
                        this.scale = Math.min(2.0, parseInt(parameter, 10) / 100.0);
                    }
                    this.appendRaw(`${tag}${parameter || ""}.`);
                    this.appendChars(text || "");
                    break;

                    case "@u":
                    // Unicode character tags
                    const [unicodeParam, rest] = content.split(".", 2);
                    const unicodeChar = String.fromCodePoint(parseInt(unicodeParam, 10));
                    const width = this.charWidth(unicodeChar);
                    this.appendChar(`${tag}${unicodeParam}.`, false, width);
                    this.appendChars(rest || "");
                    break;

                    case "@r":
                    // Newline tag
                    this.newline();
                    this.appendChars(content);
                    break;

                    default:
                    throw new Error(`Unrecognised dialogue tag: ${tag}`);
                }
            } else {
                // Text before the first tag (e.g., character names)
                this.appendRaw(e);
            }
        });

        // Add remaining content in the current element to the final result
        this.nextElement();

        // Combine all elements into a single string
        return this.elements.map((el) => el.content).join("");
    }

    newline() {
        this.appendRaw("@r");
        this.currentLineLength = 0;
    }

    nextElement(shouldBreak = false) {
        this.elements.push({ content: this.currentElement, canBreak: shouldBreak });
        this.currentLineLength += this.currentElementLength;
        this.currentElementLength = 0;
        this.currentElement = "";
    }

    checkBreak() {
        if (this.currentLineLength + this.currentElementLength > this.width) {
            if (this.currentLineLength === 0) {
                this.currentElement += "@r";
                this.currentElementLength = 0;
                return;
            }

            const lastNonBreakingIndex = this.elements
            .map((e) => !e.canBreak)
            .lastIndexOf(true);

            if (lastNonBreakingIndex !== -1) {
                this.elements = this.elements.slice(0, lastNonBreakingIndex + 1);
            }

            this.elements.push({ content: "@r", canBreak: false });
            this.currentLineLength = 0;
        }
    }

    appendChars(chars, noBreak = false) {
        [...chars].forEach((char) => this.appendChar(char, noBreak));
    }

    appendChar(char, noBreak = false, widthOverride = null) {
        const width = widthOverride || this.charWidth(char);

        if (this.canBreakOn(char) && !noBreak) {
            this.nextElement();
            this.currentElementLength += width;
            this.appendRaw(char);
            this.nextElement(true);
        } else {
            this.currentElementLength += width;
            this.appendRaw(char);
        }

        this.checkBreak();
    }

    appendRaw(content) {
        this.currentElement += content;
    }

    canBreakOn(character) {
        return /\s/.test(character);
    }
}
