const COMMANDS = {
    _commands: true,
    loadFont: 0,
    processGlyph: 1,
    fontLoaded: 2,
    glyphResult: 3
}

importScripts("https://cdn.jsdelivr.net/npm/opentype.js");

const fonts = {};

function loadFont(buffer) {
    const font = opentype.parse(buffer);
    const name = font.names.fullName.en;
    fonts[name] = font;
    console.log(font);
    const response = {
        name: name,
        glyphCount: font.glyphs.length
    }
    self.postMessage({ command: COMMANDS.fontLoaded, payload: response });
}

function processGlyph({ fontName, index }) {
    const font = fonts[fontName];
    const glyph = font.glyphs.glyphs[index];
    const canvas = new OffscreenCanvas(256, 128);
    const ctx = canvas.getContext('2d');
    glyph.draw(ctx, 128, 64, 64);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ command: COMMANDS.glyphResult, payload: bitmap }, [bitmap]);
}

onmessage = function(event) {
    if(event.data == null) {
        self.postMessage(COMMANDS);
        return;
    }

    switch(event.data.command) {
        case COMMANDS.loadFont:
            loadFont(event.data.payload);
            break;
        case COMMANDS.processGlyph:
            processGlyph(event.data.payload);
            break;
    }
}
