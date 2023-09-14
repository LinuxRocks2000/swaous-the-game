const protocolv3 = {
    defaultConfig: {
        types: {
            "String": { // encode and decode work with regular JS arrays of bytes, then it's converted to Uint8Array.
                // this is just an implementation of what we have over in the rust program
                encode(string) { // THANKS, STACKOVERFLOW
                    var utf8 = unescape(encodeURIComponent(string));
                    var arr = [Math.floor(string.length / 256), string.length % 256]; // convert length to a big endian (network order) byte array
                    for (var i = 0; i < utf8.length; i++) {
                        arr.push(utf8.charCodeAt(i)); // push in the actual data
                    }
                    return arr;
                },
                decode(bytes) {
                    var length = bytes.shift() * 256 + bytes.shift(); // go from two big endian bytes (network order, duh) to js number length; probably LE. endianness is cursed.
                    // just use big endian for everything, dipshits
                    return new TextDecoder().decode(new Uint8Array(bytes.splice(0, length)));
                }
            },
            "u8": {
                encode(data) {
                    if (typeof data == 'string') {
                        data = data.charCodeAt(0);
                    }
                    return [data];
                },
                decode(bytes) {
                    return bytes.shift();
                }
            },
            "u16": {
                encode(data) {
                    return [Math.floor(data / 256), data % 256];
                },
                decode(bytes) {
                    return bytes.shift() * 256 + bytes.shift();
                }
            },
            "u32": {
                encode(data) {
                    return [Math.floor(data / 16777216) % 256, Math.floor(data / 65536) % 256, Math.floor(data / 256) % 256, data % 256];
                },
                decode(bytes) {
                    return bytes.shift() * 16777216 + bytes.shift() * 65536 + bytes.shift() * 256 + bytes.shift();
                }
            },
            "i32": {
                encode(data) {
                    var buf = new ArrayBuffer(4);
                    var view = new DataView(buf);
                    view.setInt32(0, data);
                    var ret = [];
                    for (var x = 0; x < 4; x++) {
                        ret.push(view.getUint8(x));
                    }
                    return ret;
                },
                decode(bytes) {
                    var msb = bytes.shift();
                    if (msb > 127) {
                        msb -= 128;
                    }
                    return msb * 16777216 + bytes.shift() * 65536 + bytes.shift() * 256 + bytes.shift();
                }
            },
            "f32": {
                decode(bytes) { // THANKS, STACKOVERFLOW
                    var buf = new ArrayBuffer(4);
                    var view = new DataView(buf);
                    for (var x = 0; x < 4; x++) {
                        view.setUint8(x, bytes.shift());
                    }
                    return view.getFloat32(0);
                },
                encode(data) {
                    var buf = new ArrayBuffer(4);
                    var view = new DataView(buf);
                    view.setFloat32(0, data);
                    var ret = [];
                    for (var x = 0; x < 4; x++) {
                        ret.push(view.getUint8(x));
                    }
                    return ret;
                }
            },
            "bool": {
                decode(bytes) {
                    return bytes.shift() != 0;
                },
                encode(data) {
                    return [data ? 1 : 0];
                }
            }
        }
    },
    async connect(config, socketURI, manifestURI, uponError = () => {}) { // TODO: make this handle URIs better, right now it makes a lot of assumptions
        let manifest = await (await fetch(manifestURI)).json();
        var obj = {
            callbacks: {},
            appname: manifest.application_name,
            toServer: manifest.incoming_protocol,
            fromServer: manifest.outgoing_protocol,
            socket: new WebSocket(socketURI),
            uponError: uponError,
            sendHandle(name) {
                var op = undefined;
                var socket = this.socket;
                this.toServer.operations.forEach(item => {
                    if (item.name == name) {
                        op = item;
                    }
                });
                return (...args) => {
                    var out = [op.opcode];
                    for (var i = 0; i < op.args.length; i++) {
                        out.push(...config.types[op.args[i]].encode(args[i]));
                    }
                    socket.send(new Uint8Array(out));
                }
            },
            listen(listener) {
                this.socket.addEventListener("message", (msgdata) => {
                    var bytearray = Array.from(new Uint8Array(msgdata.data));
                    var opcode = bytearray.shift();
                    var type = undefined;
                    this.fromServer.operations.forEach(op => {
                        if (op.opcode == opcode) {
                            type = op;
                        }
                    });
                    if (type) {
                        var retProps = [];
                        type.args.forEach(rtype => {
                            if (config.types[rtype]) {
                                retProps.push(config.types[rtype].decode(bytearray));
                            }
                            else {
                                console.warn("UNEXPECTED TYPE " + rtype);
                            }
                        });
                        if (this.callbacks[type.name]) {
                            this.callbacks[type.name](...retProps);
                        }
                        else {
                            listener(type.name, retProps);
                        }
                    }
                    else {
                        console.warn("Invalid operation code " + opcode);
                    }
                });
            },
            setOnMessage(type, callback) {
                var isBad = true;
                this.fromServer.operations.forEach(item => {
                    if (item.name == type) {
                        isBad = false;
                    }
                });
                if (!isBad) {
                    this.callbacks[type] = callback;
                }
                else {
                    alert("BAD RECEIVE HANDLE " + type + "!");
                    throw new Error("Bad Receive Handle " + type);
                }
            },
            onOpen(callback) {
                this.socket.addEventListener("open", callback);
            }
        };
        obj.socket.binaryType = "arraybuffer";
        obj.socket.addEventListener("close", uponError);
        obj.socket.addEventListener("error", uponError);
        return obj;
    }
}