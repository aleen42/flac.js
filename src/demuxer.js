FLACDemuxer = Demuxer.extend(function() {
    Demuxer.register(this)
    
    this.probe = function(buffer) {
        return buffer.peekString(0, 4) === 'fLaC'
    }
    
    const STREAMINFO = 0,
          PADDING = 1,
          APPLICATION = 2,
          SEEKTABLE = 3,
          VORBIS_COMMENT = 4,
          CUESHEET = 5,
          PICTURE = 6,
          INVALID = 127,
          STREAMINFO_SIZE = 34
    
    this.prototype.readChunk = function() {
        var stream = this.stream;
        
        if (!this.readHeader && stream.available(4)) {
            if (stream.readString(4) !== 'fLaC')
                return this.emit('error', 'Invalid FLAC file.')
                
            this.readHeader = true;
        }
        
        while (stream.available(1) && !this.last) {                     
            if (!this.readBlockHeaders) {
                var tmp = stream.readUInt8()   
                this.last = (tmp & 0x80) === 0x80,
                this.type = tmp & 0x7F,
                this.size = stream.readUInt24()
            }
            
            if (!this.foundStreamInfo && this.type !== STREAMINFO)
                return this.emit('error', 'STREAMINFO must be the first block')
                
            if (!stream.available(this.size))
                return;
            
            switch (this.type) {
                case STREAMINFO:
                    if (this.foundStreamInfo)
                        return this.emit('error', 'STREAMINFO can only occur once.')
                    
                    if (this.size !== STREAMINFO_SIZE)
                        return this.emit('error', 'STREAMINFO size is wrong.')
                    
                    this.foundStreamInfo = true
                    var bitstream = new Bitstream(stream)
                
                    var cookie = {
                        minBlockSize: bitstream.read(16),
                        maxBlockSize: bitstream.read(16),
                        minFrameSize: bitstream.read(24),
                        maxFrameSize: bitstream.read(24)
                    }
                
                    this.format = {
                        formatID: 'flac',
                        sampleRate: bitstream.read(20),
                        channelsPerFrame: bitstream.readSmall(3) + 1,
                        bitsPerChannel: bitstream.readSmall(5) + 1
                    }
                
                    this.emit('format', this.format)
                    this.emit('cookie', cookie)
                
                    var sampleCount = bitstream.readBig(36);
                    this.emit('duration', sampleCount / this.format.sampleRate * 1000 | 0)
                
                    stream.advance(16) // skip MD5 hashes
                    this.readBlockHeaders = false;
                    break;
                    
                case VORBIS_COMMENT:
                    // see http://www.xiph.org/vorbis/doc/v-comment.html
                    var metadata = {},
                        len = stream.readUInt32(true);
                    
                    metadata.vendor = stream.readString(len)
                    var length = stream.readUInt32(true)
                    
                    for (var i = 0; i < length; i++) {
                        len = stream.readUInt32(true)
                        var str = decodeURIComponent(escape(stream.readString(len))),
                            idx = str.indexOf('=')
                            
                        metadata[str.slice(0, idx)] = str.slice(idx + 1)
                    }
                    
                    // TODO: standardize field names accross formats
                    this.emit('metadata', metadata)
                    break;
                
                default:
                    stream.advance(this.size)
                    this.readBlockHeaders = false;
            }
        }
        
        while (stream.available(1) && this.last) {
            var buffer = stream.readSingleBuffer(stream.remainingBytes())
            this.emit('data', buffer, stream.remainingBytes() === 0)
        }
    }
    
})