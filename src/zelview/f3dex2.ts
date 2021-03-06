
import { mat4, vec3 } from 'gl-matrix';

import * as Render from './render';
import * as ZELVIEW0 from './zelview0';

import { CullMode, RenderState, RenderFlags, Program, BlendMode } from '../render';
import * as Viewer from '../viewer';

// Zelda uses the F3DEX2 display list format. This implements
// a simple (and probably wrong!) HLE renderer for it.

type CmdFunc = (renderState: RenderState) => void;

const UCodeCommands = {
    VTX: 0x01,
    TRI1: 0x05,
    TRI2: 0x06,
    GEOMETRYMODE: 0xD9,

    SETOTHERMODE_L: 0xE2,
    SETOTHERMODE_H: 0xE3,

    DL: 0xDE,
    ENDDL: 0xDF,

    MTX: 0xDA,
    POPMTX: 0xD8,

    TEXTURE: 0xD7,
    LOADTLUT: 0xF0,
    LOADBLOCK: 0xF3,
    SETTILESIZE: 0xF2,
    SETTILE: 0xF5,
    SETPRIMCOLOR: 0xF9,
    SETENVCOLOR: 0xFB,
    SETCOMBINE: 0xFC,
    SETTIMG: 0xFD,
    RDPLOADSYNC: 0xE6,
    RDPPIPESYNC: 0xE7,
};

// Latest TypeScript broke for...in: https://github.com/Microsoft/TypeScript/issues/19203
/*
var UCodeNames = {};
for (var name in UCodeCommands)
    UCodeNames[UCodeCommands[name]] = name;
*/

class State {
    public gl: WebGL2RenderingContext;

    public cmds: CmdFunc[];
    public textures: Viewer.Texture[];

    public mtx: mat4;
    public mtxStack: mat4[];

    public vertexBuffer: Float32Array;
    public vertexBufferGL: WebGLBuffer;
    public verticesDirty: boolean[];
    public geometryMode: number;
    public otherModeL: number;

    public paletteTile: any;
    public textureTile: {};
    public boundTexture: any;
    public textureImage: any;
    public tile: any;

    public rom: any;
    public banks: any;

    public lookupAddress(addr: number) {
        return this.rom.lookupAddress(this.banks, addr);
    }
}

// 3 pos + 2 uv + 4 color/nrm
const VERTEX_SIZE = 9;
const VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

function readVertex(state: State, which: number, addr: number) {
    const rom = state.rom;
    const offs = state.lookupAddress(addr);
    const posX = rom.view.getInt16(offs + 0, false);
    const posY = rom.view.getInt16(offs + 2, false);
    const posZ = rom.view.getInt16(offs + 4, false);

    const pos = vec3.clone([posX, posY, posZ]);
    vec3.transformMat4(pos, pos, state.mtx);

    const txU = rom.view.getInt16(offs + 8, false) * (1 / 32);
    const txV = rom.view.getInt16(offs + 10, false) * (1 / 32);

    const vtxArray = new Float32Array(state.vertexBuffer.buffer, which * VERTEX_BYTES, VERTEX_SIZE);
    vtxArray[0] = pos[0]; vtxArray[1] = pos[1]; vtxArray[2] = pos[2];
    vtxArray[3] = txU; vtxArray[4] = txV;

    vtxArray[5] = rom.view.getUint8(offs + 12) / 255;
    vtxArray[6] = rom.view.getUint8(offs + 13) / 255;
    vtxArray[7] = rom.view.getUint8(offs + 14) / 255;
    vtxArray[8] = rom.view.getUint8(offs + 15) / 255;
}

function cmd_VTX(state: State, w0: number, w1: number) {
    const N = (w0 >> 12) & 0xFF;
    const V0 = ((w0 >> 1) & 0x7F) - N;
    let addr = w1;

    for (let i = 0; i < N; i++) {
        const which = V0 + i;
        readVertex(state, which, addr);
        addr += 16;

        state.verticesDirty[which] = true;
    }
}

function translateTRI(state: State, idxData: Uint8Array) {
    const gl = state.gl;

    function anyVertsDirty() {
        for (const idx of idxData)
            if (state.verticesDirty[idx])
                return true;
        return false;
    }

    function createGLVertBuffer() {
        const vertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, state.vertexBuffer, gl.STATIC_DRAW);
        return vertBuffer;
    }
    function getVertexBufferGL() {
        if (anyVertsDirty() || !state.vertexBufferGL) {
            state.vertexBufferGL = createGLVertBuffer();
            state.verticesDirty = [];
        }
        return state.vertexBufferGL;
    }

    const vertBuffer = getVertexBufferGL();
    const idxBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

    const nPrim = idxData.length;

    return function drawTri(renderState: RenderState) {
        const prog = (<Render.F3DEX2Program> renderState.currentProgram);
        const gl = renderState.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
        gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.vertexAttribPointer(prog.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 5 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(prog.positionLocation);
        gl.enableVertexAttribArray(prog.colorLocation);
        gl.enableVertexAttribArray(prog.uvLocation);
        gl.drawElements(gl.TRIANGLES, nPrim, gl.UNSIGNED_BYTE, 0);
        gl.disableVertexAttribArray(prog.positionLocation);
        gl.disableVertexAttribArray(prog.uvLocation);
        gl.disableVertexAttribArray(prog.colorLocation);
    };
}

function tri(idxData: Uint8Array, offs: number, cmd: number) {
    idxData[offs + 0] = (cmd >> 17) & 0x7F;
    idxData[offs + 1] = (cmd >> 9) & 0x7F;
    idxData[offs + 2] = (cmd >> 1) & 0x7F;
}

function flushTexture(state: State) {
    if (state.textureTile)
        loadTile(state, state.textureTile);
}

function cmd_TRI1(state: State, w0: number, w1: number) {
    flushTexture(state);
    const idxData = new Uint8Array(3);
    tri(idxData, 0, w0);
    state.cmds.push(translateTRI(state, idxData));
}

function cmd_TRI2(state: State, w0: number, w1: number) {
    flushTexture(state);
    const idxData = new Uint8Array(6);
    tri(idxData, 0, w0); tri(idxData, 3, w1);
    state.cmds.push(translateTRI(state, idxData));
}

const GeometryMode = {
    CULL_FRONT: 0x0200,
    CULL_BACK: 0x0400,
    LIGHTING: 0x020000,
};

function cmd_GEOMETRYMODE(state: State, w0: number, w1: number) {
    state.geometryMode = state.geometryMode & ((~w0) & 0x00FFFFFF) | w1;
    const newMode = state.geometryMode;

    const renderFlags = new RenderFlags();

    const cullFront = newMode & GeometryMode.CULL_FRONT;
    const cullBack = newMode & GeometryMode.CULL_BACK;

    if (cullFront && cullBack)
        renderFlags.cullMode = CullMode.FRONT_AND_BACK;
    else if (cullFront)
        renderFlags.cullMode = CullMode.FRONT;
    else if (cullBack)
        renderFlags.cullMode = CullMode.BACK;
    else
        renderFlags.cullMode = CullMode.NONE;

    state.cmds.push((renderState: RenderState) => {
        const gl = renderState.gl;
        const prog = (<Render.F3DEX2Program> renderState.currentProgram);

        renderState.useFlags(renderFlags);

        const lighting = newMode & GeometryMode.LIGHTING;
        const useVertexColors = lighting ? 0 : 1;
        gl.uniform1i(prog.useVertexColorsLocation, useVertexColors);
    });
}

const OtherModeL = {
    Z_CMP: 0x0010,
    Z_UPD: 0x0020,
    ZMODE_DEC: 0x0C00,
    CVG_X_ALPHA: 0x1000,
    ALPHA_CVG_SEL: 0x2000,
    FORCE_BL: 0x4000,
};

function cmd_SETOTHERMODE_L(state: State, w0: number, w1: number) {
    const mode = 31 - (w0 & 0xFF);
    if (mode === 3) {
        const renderFlags = new RenderFlags();
        const newMode = w1;

        renderFlags.depthTest = !!(newMode & OtherModeL.Z_CMP);
        renderFlags.depthWrite = !!(newMode & OtherModeL.Z_UPD);

        let alphaTestMode;
        if (newMode & OtherModeL.FORCE_BL) {
            alphaTestMode = 0;
            renderFlags.blendMode = BlendMode.ADD;
        } else {
            alphaTestMode = ((newMode & OtherModeL.CVG_X_ALPHA) ? 0x1 : 0 |
                             (newMode & OtherModeL.ALPHA_CVG_SEL) ? 0x2 : 0);
            renderFlags.blendMode = BlendMode.NONE;
        }
   
        state.cmds.push((renderState: RenderState) => {
            const gl = renderState.gl;
            const prog = (<Render.F3DEX2Program> renderState.currentProgram);

            renderState.useFlags(renderFlags);

            if (newMode & OtherModeL.ZMODE_DEC) {
                gl.enable(gl.POLYGON_OFFSET_FILL);
                gl.polygonOffset(-0.5, -0.5);
            } else {
                gl.disable(gl.POLYGON_OFFSET_FILL);
            }

            gl.uniform1i(prog.alphaTestLocation, alphaTestMode);
        });
    }
}

function cmd_DL(state: State, w0: number, w1: number) {
    runDL(state, w1);
}

function cmd_MTX(state: State, w0: number, w1: number) {
    if (w1 & 0x80000000) state.mtx = state.mtxStack.pop();
    w1 &= ~0x80000000;

    state.geometryMode = 0;
    state.otherModeL = 0;

    state.mtxStack.push(state.mtx);
    state.mtx = mat4.clone(state.mtx);

    const rom = state.rom;
    let offs = state.lookupAddress(w1);

    const mtx = mat4.create();

    for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
            const mt1 = rom.view.getUint16(offs, false);
            const mt2 = rom.view.getUint16(offs + 32, false);
            mtx[(x * 4) + y] = ((mt1 << 16) | (mt2)) * (1 / 0x10000);
            offs += 2;
        }
    }

    mat4.multiply(state.mtx, state.mtx, mtx);
}

function cmd_POPMTX(state: State, w0: number, w1: number) {
    state.mtx = state.mtxStack.pop();
}

function cmd_TEXTURE(state: State, w0: number, w1: number) {
    const boundTexture = {};
    state.boundTexture = boundTexture;

    const s = w1 >> 16;
    const t = w1 & 0x0000FFFF;

    state.boundTexture.scaleS = (s + 1) / 0x10000;
    state.boundTexture.scaleT = (t + 1) / 0x10000;
}

function r5g5b5a1(dst: Uint8Array, dstOffs: number, p: number) {
    let r, g, b, a;

    r = (p & 0xF800) >> 11;
    r = (r << (8 - 5)) | (r >> (10 - 8));

    g = (p & 0x07C0) >> 6;
    g = (g << (8 - 5)) | (g >> (10 - 8));

    b = (p & 0x003E) >> 1;
    b = (b << (8 - 5)) | (b >> (10 - 8));

    a = (p & 0x0001) ? 0xFF : 0x00;

    dst[dstOffs + 0] = r;
    dst[dstOffs + 1] = g;
    dst[dstOffs + 2] = b;
    dst[dstOffs + 3] = a;
}

function cmd_SETTIMG(state: State, w0: number, w1: number) {
    state.textureImage = {};
    state.textureImage.format = (w0 >> 21) & 0x7;
    state.textureImage.size = (w0 >> 19) & 0x3;
    state.textureImage.width = (w0 & 0x1000) + 1;
    state.textureImage.addr = w1;
}

function cmd_SETTILE(state: State, w0: number, w1: number) {
    state.tile = {};
    const tile = state.tile;

    tile.format = (w0 >> 16) & 0xFF;
    tile.cms = (w1 >> 8) & 0x3;
    tile.cmt = (w1 >> 18) & 0x3;
    tile.tmem = w0 & 0x1FF;
    tile.lineSize = (w0 >> 9) & 0x1FF;
    tile.palette = (w1 >> 20) & 0xF;
    tile.shiftS = w1 & 0xF;
    tile.shiftT = (w1 >> 10) & 0xF;
    tile.maskS = (w1 >> 4) & 0xF;
    tile.maskT = (w1 >> 14) & 0xF;
}

function cmd_SETTILESIZE(state: State, w0: number, w1: number) {
    const tileIdx = (w1 >> 24) & 0x7;
    const tile = state.tile;

    tile.uls = (w0 >> 14) & 0x3FF;
    tile.ult = (w0 >> 2) & 0x3FF;
    tile.lrs = (w1 >> 14) & 0x3FF;
    tile.lrt = (w1 >> 2) & 0x3FF;
}

function cmd_LOADTLUT(state: State, w0: number, w1: number) {
    const rom = state.rom;

    // XXX: properly implement uls/ult/lrs/lrt
    const size = ((w1 & 0x00FFF000) >> 14) + 1;
    const dst = new Uint8Array(size * 4);

    let srcOffs = state.lookupAddress(state.textureImage.addr);
    let dstOffs = 0;

    for (let i = 0; i < size; i++) {
        const pixel = rom.view.getUint16(srcOffs, false);
        r5g5b5a1(dst, dstOffs, pixel);
        srcOffs += 2;
        dstOffs += 4;
    }

    state.paletteTile = state.tile;
    state.paletteTile.pixels = dst;
}

function tileCacheKey(state: State, tile: any) {
    // XXX: Do we need more than this?
    const srcOffs = state.lookupAddress(tile.addr);
    return srcOffs;
}

// XXX: This is global to cut down on resources between DLs.
const tileCache: any = {};
function loadTile(state: State, tile: any) {
    if (tile.textureId)
        return;

    const key = tileCacheKey(state, tile);
    const otherTile = tileCache[key];
    if (!otherTile) {
        translateTexture(state, tile);
        tileCache[key] = tile;
    } else if (tile !== otherTile) {
        tile.textureId = otherTile.textureId;
        tile.width = otherTile.width;
        tile.height = otherTile.height;
        tile.wrapS = otherTile.wrapS;
        tile.wrapT = otherTile.wrapT;
    }
}

function convert_CI4(state: State, texture) {
    const palette = state.paletteTile.pixels;
    if (!palette)
        return;

    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);
    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);
            let idx;

            idx = ((b & 0xF0) >> 4) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];

            idx = (b & 0x0F) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
        }
    }

    texture.pixels = dst;
}

function convert_I4(state, texture) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);

            let p;
            p = (b & 0xF0) >> 4;
            p = p << 4 | p;
            dst[i++] = p;
            dst[i++] = p;

            p = (b & 0x0F);
            p = p << 4 | p;
            dst[i++] = p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_IA4(state, texture) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x += 2) {
            const b = state.rom.view.getUint8(srcOffs++);
            let p; let pm;

            p = (b & 0xF0) >> 4;
            pm = p & 0x0E;
            dst[i++] = (pm << 4 | pm);
            dst[i++] = (p & 0x01) ? 0xFF : 0x00;

            p = (b & 0x0F);
            pm = p & 0x0E;
            dst[i++] = (pm << 4 | pm);
            dst[i++] = (p & 0x01) ? 0xFF : 0x00;
        }
    }

    texture.pixels = dst;
}

function convert_CI8(state, texture) {
    const palette = state.paletteTile.pixels;
    if (!palette)
        return;

    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            let idx = state.rom.view.getUint8(srcOffs) * 4;
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            dst[i++] = palette[idx++];
            srcOffs++;
        }
    }

    texture.pixels = dst;
}

function convert_I8(state, texture) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const p = state.rom.view.getUint8(srcOffs++);
            dst[i++] = p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_IA8(state, texture) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const b = state.rom.view.getUint8(srcOffs++);
            let p;

            p = (b & 0xF0) >> 4;
            p = p << 4 | p;
            dst[i++] = p;

            p = (b & 0x0F);
            p = p >> 4 | p;
            dst[i++] = p;
        }
    }

    texture.pixels = dst;
}

function convert_RGBA16(state, texture) {
    const rom = state.rom;
    const nBytes = texture.width * texture.height * 4;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            const pixel = rom.view.getUint16(srcOffs, false);
            r5g5b5a1(dst, i, pixel);
            i += 4;
            srcOffs += 2;
        }
    }

    texture.pixels = dst;
}

function convert_IA16(state, texture) {
    const nBytes = texture.width * texture.height * 2;
    const dst = new Uint8Array(nBytes);

    let srcOffs = state.lookupAddress(texture.addr);
    let i = 0;
    for (let y = 0; y < texture.height; y++) {
        for (let x = 0; x < texture.width; x++) {
            dst[i++] = state.rom.view.getUint8(srcOffs++);
            dst[i++] = state.rom.view.getUint8(srcOffs++);
        }
    }

    texture.pixels = dst;
}

function textureToCanvas(texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    if (texture.dstFormat === "i8") {
        for (let si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
            imgData.data[di + 0] = texture.pixels[si];
            imgData.data[di + 1] = texture.pixels[si];
            imgData.data[di + 2] = texture.pixels[si];
            imgData.data[di + 3] = 255;
        }
    } else if (texture.dstFormat === "i8_a8") {
        for (let si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
            imgData.data[di + 0] = texture.pixels[si];
            imgData.data[di + 1] = texture.pixels[si];
            imgData.data[di + 2] = texture.pixels[si];
            imgData.data[di + 3] = texture.pixels[si + 1];
        }
    } else if (texture.dstFormat === "rgba8") {
        imgData.data.set(texture.pixels);
    }

    canvas.title = '0x' + texture.addr.toString(16) + '  ' + texture.format.toString(16) + '  ' + texture.dstFormat;
    ctx.putImageData(imgData, 0, 0);

    const surfaces = [ canvas ];
    return { name: canvas.title, surfaces };
}

function translateTexture(state, texture) {
    const gl = state.gl;

    calcTextureSize(texture);

    function convertTexturePixels() {
        switch (texture.format) {
            // 4-bit
            case 0x40: return convert_CI4(state, texture);    // CI
            case 0x60: return convert_IA4(state, texture);    // IA
            case 0x80: return convert_I4(state, texture);     // I
            // 8-bit
            case 0x48: return convert_CI8(state, texture);    // CI
            case 0x68: return convert_IA8(state, texture);    // IA
            case 0x88: return convert_I8(state, texture);     // I
            // 16-bit
            case 0x10: return convert_RGBA16(state, texture); // RGBA
            case 0x70: return convert_IA16(state, texture);   // IA
            default: console.error("Unsupported texture", texture.format.toString(16));
        }
    }

    texture.dstFormat = calcTextureDestFormat(texture);

    const srcOffs = state.lookupAddress(texture.addr);
    if (srcOffs !== null)
        convertTexturePixels();

    if (!texture.pixels) {
        if (texture.dstFormat === "i8")
            texture.pixels = new Uint8Array(texture.width * texture.height);
        else if (texture.dstFormat === "i8_a8")
            texture.pixels = new Uint8Array(texture.width * texture.height * 2);
        else if (texture.dstFormat === "rgba8")
            texture.pixels = new Uint8Array(texture.width * texture.height * 4);
    }

    function translateWrap(cm) {
        switch (cm) {
            case 1: return gl.MIRRORED_REPEAT;
            case 2: return gl.CLAMP_TO_EDGE;
            case 3: return gl.CLAMP_TO_EDGE;
            default: return gl.REPEAT;
        }
    }

    texture.wrapT = translateWrap(texture.cmt);
    texture.wrapS = translateWrap(texture.cms);

    const texId = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texId);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let glFormat;
    if (texture.dstFormat === "i8")
        glFormat = gl.LUMINANCE;
    else if (texture.dstFormat === "i8_a8")
        glFormat = gl.LUMINANCE_ALPHA;
    else if (texture.dstFormat === "rgba8")
        glFormat = gl.RGBA;

    gl.texImage2D(gl.TEXTURE_2D, 0, glFormat, texture.width, texture.height, 0, glFormat, gl.UNSIGNED_BYTE, texture.pixels);
    texture.textureId = texId;

    state.textures.push(textureToCanvas(texture));
}

function calcTextureDestFormat(texture) {
    switch (texture.format & 0xE0) {
        case 0x00: return "rgba8"; // RGBA
        case 0x40: return "rgba8"; // CI -- XXX -- do we need to check the palette type?
        case 0x60: return "i8_a8"; // IA
        case 0x80: return "i8_a8"; // I
        default: throw new Error("Invalid texture type");
    }
}

function calcTextureSize(texture) {
    let maxTexel, lineShift;
    switch (texture.format) {
        // 4-bit
        case 0x00: maxTexel = 4096; lineShift = 4; break; // RGBA
        case 0x40: maxTexel = 4096; lineShift = 4; break; // CI
        case 0x60: maxTexel = 8196; lineShift = 4; break; // IA
        case 0x80: maxTexel = 8196; lineShift = 4; break; // I
        // 8-bit
        case 0x08: maxTexel = 2048; lineShift = 3; break; // RGBA
        case 0x48: maxTexel = 2048; lineShift = 3; break; // CI
        case 0x68: maxTexel = 4096; lineShift = 3; break; // IA
        case 0x88: maxTexel = 4096; lineShift = 3; break; // I
        // 16-bit
        case 0x10: maxTexel = 2048; lineShift = 2; break; // RGBA
        case 0x50: maxTexel = 2048; lineShift = 0; break; // CI
        case 0x70: maxTexel = 2048; lineShift = 2; break; // IA
        case 0x90: maxTexel = 2048; lineShift = 0; break; // I
        // 32-bit
        case 0x18: maxTexel = 1024; lineShift = 2; break; // RGBA
    }

    const lineW = texture.lineSize << lineShift;
    texture.rowStride = lineW;
    const tileW = texture.lrs - texture.uls + 1;
    const tileH = texture.lrt - texture.ult + 1;

    const maskW = 1 << texture.maskS;
    const maskH = 1 << texture.maskT;

    let lineH;
    if (lineW > 0)
        lineH = Math.min(maxTexel / lineW, tileH);
    else
        lineH = 0;

    let width;
    if (texture.maskS > 0 && (maskW * maskH) <= maxTexel)
        width = maskW;
    else if ((tileW * tileH) <= maxTexel)
        width = tileW;
    else
        width = lineW;

    let height;
    if (texture.maskT > 0 && (maskW * maskH) <= maxTexel)
        height = maskH;
    else if ((tileW * tileH) <= maxTexel)
        height = tileH;
    else
        height = lineH;

    texture.width = width;
    texture.height = height;
}

const CommandDispatch = {};
CommandDispatch[UCodeCommands.VTX] = cmd_VTX;
CommandDispatch[UCodeCommands.TRI1] = cmd_TRI1;
CommandDispatch[UCodeCommands.TRI2] = cmd_TRI2;
CommandDispatch[UCodeCommands.GEOMETRYMODE] = cmd_GEOMETRYMODE;
CommandDispatch[UCodeCommands.DL] = cmd_DL;
CommandDispatch[UCodeCommands.MTX] = cmd_MTX;
CommandDispatch[UCodeCommands.POPMTX] = cmd_POPMTX;
CommandDispatch[UCodeCommands.SETOTHERMODE_L] = cmd_SETOTHERMODE_L;
CommandDispatch[UCodeCommands.LOADTLUT] = cmd_LOADTLUT;
CommandDispatch[UCodeCommands.TEXTURE] = cmd_TEXTURE;
CommandDispatch[UCodeCommands.SETTIMG] = cmd_SETTIMG;
CommandDispatch[UCodeCommands.SETTILE] = cmd_SETTILE;
CommandDispatch[UCodeCommands.SETTILESIZE] = cmd_SETTILESIZE;

const F3DEX2 = {};

function loadTextureBlock(state, cmds) {
    const tileIdx = (cmds[5][1] >> 24) & 0x7;
    if (tileIdx !== 0)
        return;

    cmd_SETTIMG(state, cmds[0][0], cmds[0][1]);
    cmd_SETTILE(state, cmds[5][0], cmds[5][1]);
    cmd_SETTILESIZE(state, cmds[6][0], cmds[6][1]);
    const tile = state.tile;
    state.textureTile = tile;
    tile.addr = state.textureImage.addr;
    state.cmds.push((renderState: RenderState) => {
        const gl = renderState.gl;

        if (!tile.textureId)
            return;

        gl.bindTexture(gl.TEXTURE_2D, tile.textureId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, tile.wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, tile.wrapT);
        const prog = (<Render.F3DEX2Program> renderState.currentProgram);
        gl.uniform2fv(prog.txsLocation, [1 / tile.width, 1 / tile.height]);
    });
}

function runDL(state, addr) {
    function collectNextCmds() {
        const L = [];
        let voffs = offs;
        for (let i = 0; i < 8; i++) {
            const cmd0 = rom.view.getUint32(voffs, false);
            const cmd1 = rom.view.getUint32(voffs + 4, false);
            L.push([cmd0, cmd1]);
            voffs += 8;
        }
        return L;
    }
    function matchesCmdStream(cmds, needle) {
        for (let i = 0; i < needle.length; i++)
            if (cmds[i][0] >>> 24 !== needle[i])
                return false;
        return true;
    }

    const rom = state.rom;
    let offs = state.lookupAddress(addr);
    if (offs === null)
        return;
    while (true) {
        const cmd0 = rom.view.getUint32(offs, false);
        const cmd1 = rom.view.getUint32(offs + 4, false);

        const cmdType = cmd0 >>> 24;
        if (cmdType === UCodeCommands.ENDDL)
            break;

        // Texture uploads need to be special.
        if (cmdType === UCodeCommands.SETTIMG) {
            const U = UCodeCommands;
            const nextCmds = collectNextCmds();
            if (matchesCmdStream(nextCmds, [U.SETTIMG, U.SETTILE, U.RDPLOADSYNC, U.LOADBLOCK, U.RDPPIPESYNC, U.SETTILE, U.SETTILESIZE])) {
                loadTextureBlock(state, nextCmds);
                offs += 7 * 8;
                continue;
            }
        }

        const func = CommandDispatch[cmdType];
        if (func)
            func(state, cmd0, cmd1);
        offs += 8;
    }
}

export class DL {
    public cmds: CmdFunc[];
    public textures: Viewer.Texture[];

    constructor(cmds: CmdFunc[], textures: Viewer.Texture[]) {
        this.cmds = cmds;
        this.textures = textures;
    }
}

export function readDL(gl: WebGL2RenderingContext, rom, banks, startAddr): DL {
    const state = new State();

    state.gl = gl;
    state.cmds = [];
    state.textures = [];

    state.mtx = mat4.create();
    state.mtxStack = [state.mtx];

    state.vertexBuffer = new Float32Array(32 * VERTEX_SIZE);
    state.verticesDirty = [];

    state.paletteTile = {};
    state.rom = rom;
    state.banks = banks;

    runDL(state, startAddr);
    return new DL(state.cmds, state.textures);
}
