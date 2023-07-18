class ReaderWrapper {
    constructor(rsdr) {
        this.reader = rsdr;
        this.pos = 0;
    }

    async readCStr() {
        let bytes = [];

        let nextByte = (await this.readDataView(1)).getUint8();
        while(nextByte != 0) {
            bytes.push(nextByte);
            nextByte = (await this.readDataView(1)).getUint8();
        }

        return (new TextDecoder().decode(new Uint8Array(bytes)));
    }

    async readS8() {
        return (await this.readDataView(1)).getInt8(0);
    }

    async readU8() {
        return (await this.readDataView(1)).getUint8(0);
    }

    async readU16() {
        return (await this.readDataView(2)).getUint16(0, true);
    }

    async readU32() {
        return (await this.readDataView(4)).getUint32(0, true);
    }

    async readU8Array(n) {
        return new Uint8Array(await this.readBytes(n));
    }

    async readDataView(n) {
        return new DataView(await this.readBytes(n));
    }

    async readBytes(n) {
        return await this.readOrSeek(n, true);
    }

    async seekAhead(n) {
        if(n === 0) return;
        await this.readOrSeek(n, false);
    }

    async readOrSeek(n, doRead) {
        if(this.currentChunk == null) {
            await this.tryReadNextChunk();
        }

        let buffer = doRead ? new ArrayBuffer(n) : null;
        let result = doRead ? new Uint8Array(buffer) : null;
        let bytesRead = 0;

        while(bytesRead < n) {
            const bytesToRead = Math.min(this.currentChunk.length - this.currentChunkOffset, n - bytesRead);
            if(doRead) result.set(this.currentChunk.subarray(this.currentChunkOffset, this.currentChunkOffset + bytesToRead), bytesRead);
            this.currentChunkOffset += bytesToRead;

            if(this.currentChunkOffset >= this.currentChunk.length) {
                if(this.currentChunkOffset > this.currentChunk.length) {
                    throw new Error('somehow, we read too much');
                }

                await this.tryReadNextChunk();
            }

            bytesRead += bytesToRead;
            this.pos += bytesToRead;
        }

        return doRead ? buffer : null;
    }

    async tryReadNextChunk() {
        let result = await this.reader.read();
        if(result.done) {
            throw new Error('done');
        }

        this.currentChunk = result.value;
        this.currentChunkOffset = 0;
    }
}

// Simple wrapper class around a FileSystemWritableFileStream that keeps track of the current position
class WriterPositionTracker {
    constructor(writer) {
        this.writer = writer;
        this.position = 0;
        this.length = 0;
    }

    async write(data) {
        await this.writer.write(data);
        this.position += data.length;
        if(this.position > this.length) this.length = this.position;
    }

    async seek(pos) {
        await this.writer.seek(pos);
        this.position = pos;
    }

    async align(mul) {
        const a = mul - 1;
        await this.seek((this.position + a) & ~a);
    }
}

function arrayCompare(array, other) {
    for(let i = 0; i < array.length; i++) {
        if(array[i] !== other[i]) return false;
    }
    return true;
}