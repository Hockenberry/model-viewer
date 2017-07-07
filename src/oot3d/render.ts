
/// <reference path="../decl.d.ts" />

import * as ZSI from 'zsi';
import * as CMB from 'cmb';
import * as Viewer from 'viewer';
import { fetch } from 'util';

const DL_VERT_SHADER_SOURCE = `
    precision mediump float;
    uniform mat4 u_modelView;
    uniform mat4 u_localMatrix;
    uniform mat4 u_projection;
    uniform float u_posScale;
    uniform float u_uvScale;
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec4 a_color;
    varying vec4 v_color;
    varying vec2 v_uv;

    void main() {
        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0) * u_posScale;
        v_color = a_color;
        v_uv = a_uv * u_uvScale;
        v_uv.t = 1.0 - v_uv.t;
    }
`;

const DL_FRAG_SHADER_SOURCE = `
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_color;
    uniform sampler2D u_texture;
    uniform bool u_alphaTest;
    
    void main() {
        gl_FragColor = texture2D(u_texture, v_uv);
        gl_FragColor *= v_color;
        if (u_alphaTest && gl_FragColor.a <= 0.8)
            discard;
    }
`;

class OoT3D_Program extends Viewer.Program {
    posScaleLocation:WebGLUniformLocation;
    uvScaleLocation:WebGLUniformLocation;
    alphaTestLocation:WebGLUniformLocation;
    positionLocation:number;
    colorLocation:number;
    uvLocation:number;

    vert = DL_VERT_SHADER_SOURCE;
    frag = DL_FRAG_SHADER_SOURCE;

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        super.bind(gl, prog);

        this.posScaleLocation = gl.getUniformLocation(prog, "u_posScale");
        this.uvScaleLocation = gl.getUniformLocation(prog, "u_uvScale");
        this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
        this.positionLocation = gl.getAttribLocation(prog, "a_position");
        this.colorLocation = gl.getAttribLocation(prog, "a_color");
        this.uvLocation = gl.getAttribLocation(prog, "a_uv");
    }
}

function textureToCanvas(texture:CMB.Texture) {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < imgData.data.length; i++)
        imgData.data[i] = texture.pixels[i];

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

class Scene implements Viewer.Scene {
    textures:HTMLCanvasElement[];
    program:OoT3D_Program;
    zsi:ZSI.ZSI;
    model:Function;

    constructor(gl:WebGLRenderingContext, zsi:ZSI.ZSI) {
        this.program = new OoT3D_Program();
        this.textures = zsi.mesh.textures.map((texture) => {
            return textureToCanvas(texture);
        });
        this.zsi = zsi;

        this.model = this.translateModel(gl, zsi.mesh);
    }

    translateDataType(gl:WebGLRenderingContext, dataType:CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return gl.BYTE;
            case CMB.DataType.UByte:  return gl.UNSIGNED_BYTE;
            case CMB.DataType.Short:  return gl.SHORT;
            case CMB.DataType.UShort: return gl.UNSIGNED_SHORT;
            case CMB.DataType.Int:    return gl.INT;
            case CMB.DataType.UInt:   return gl.UNSIGNED_INT;
            case CMB.DataType.Float:  return gl.FLOAT;
            default: throw new Error();
        }
    }

    dataTypeSize(dataType:CMB.DataType) {
        switch (dataType) {
            case CMB.DataType.Byte:   return 1;
            case CMB.DataType.UByte:  return 1;
            case CMB.DataType.Short:  return 2;
            case CMB.DataType.UShort: return 2;
            case CMB.DataType.Int:    return 4;
            case CMB.DataType.UInt:   return 4;
            case CMB.DataType.Float:  return 4;
            default: throw new Error();
        }
    }

    translateSepd(gl:WebGLRenderingContext, cmbContext, sepd:CMB.Sepd) {
        return () => {
            gl.uniform1f(this.program.uvScaleLocation, sepd.txcScale);
            gl.uniform1f(this.program.posScaleLocation, sepd.posScale);

            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
            gl.vertexAttribPointer(this.program.positionLocation, 3, this.translateDataType(gl, sepd.posType), false, 0, sepd.posStart);

            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
            gl.vertexAttribPointer(this.program.colorLocation, 4, this.translateDataType(gl, sepd.colType), true, 0, sepd.colStart);

            gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
            gl.vertexAttribPointer(this.program.uvLocation, 2, this.translateDataType(gl, sepd.txcType), false, 0, sepd.txcStart);

            gl.enableVertexAttribArray(this.program.positionLocation);
            gl.enableVertexAttribArray(this.program.colorLocation);
            gl.enableVertexAttribArray(this.program.uvLocation);

            for (const prm of sepd.prms)
                gl.drawElements(gl.TRIANGLES, prm.count, this.translateDataType(gl, prm.indexType), prm.offset * this.dataTypeSize(prm.indexType));

            gl.disableVertexAttribArray(this.program.positionLocation);
            gl.disableVertexAttribArray(this.program.colorLocation);
            gl.disableVertexAttribArray(this.program.uvLocation);
        };
    }

    translateTexture(gl:WebGLRenderingContext, texture:CMB.Texture):WebGLTexture {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        return texId;
    }

    translateMaterial(gl:WebGLRenderingContext, cmbContext, material:CMB.Material) {
        function translateWrapMode(wrapMode:CMB.TextureWrapMode) {
            switch (wrapMode) {
            case CMB.TextureWrapMode.CLAMP: return gl.CLAMP_TO_EDGE;
            case CMB.TextureWrapMode.REPEAT: return gl.REPEAT;
            default: throw new Error();
            }
        }

        function translateTextureFilter(filter:CMB.TextureFilter) {
            switch (filter) {
            case CMB.TextureFilter.LINEAR: return gl.LINEAR;
            case CMB.TextureFilter.NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR: return gl.NEAREST;
            case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST: return gl.NEAREST;
            case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR: return gl.NEAREST;
            default: throw new Error();
            }
        }

        return () => {
            for (let i = 0; i < 1; i++) {
                const binding = material.textureBindings[i];
                if (binding.textureIdx === -1)
                    continue;

                gl.uniform1i(this.program.alphaTestLocation, material.alphaTestEnable ? 1 : 0);

                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, cmbContext.textures[binding.textureIdx]);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, translateTextureFilter(binding.minFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, translateTextureFilter(binding.magFilter));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrapMode(binding.wrapS));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrapMode(binding.wrapT));
            }
        };
    }

    translateMesh(gl:WebGLRenderingContext, cmbContext, mesh:CMB.Mesh) {
        const mat = cmbContext.matFuncs[mesh.matsIdx];
        const sepd = cmbContext.sepdFuncs[mesh.sepdIdx];

        return () => {
            mat(mesh);
            sepd();
        };
    }

    translateCmb(gl:WebGLRenderingContext, cmb:CMB.CMB) {
        if (!cmb)
            return () => {};

        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.posBuffer, gl.STATIC_DRAW);

        const colBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.colBuffer, gl.STATIC_DRAW);

        const nrmBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.nrmBuffer, gl.STATIC_DRAW);

        const txcBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, txcBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.txcBuffer, gl.STATIC_DRAW);

        const textures:WebGLTexture[] = cmb.textures.map((texture) => {
            return this.translateTexture(gl, texture);
        })

        const cmbContext:any = {
            posBuffer: posBuffer,
            colBuffer: colBuffer,
            nrmBuffer: nrmBuffer,
            txcBuffer: txcBuffer,
            textures: textures,
        };

        cmbContext.sepdFuncs = cmb.sepds.map((sepd) => this.translateSepd(gl, cmbContext, sepd));
        cmbContext.matFuncs = cmb.materials.map((material) => this.translateMaterial(gl, cmbContext, material));

        const meshFuncs = cmb.meshs.map((mesh) => this.translateMesh(gl, cmbContext, mesh));

        const idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cmb.indexBuffer, gl.STATIC_DRAW);

        return () => {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            for (const func of meshFuncs)
                func();
        };
    }

    translateModel(gl:WebGLRenderingContext, mesh:ZSI.Mesh) {
        const opaque = this.translateCmb(gl, mesh.opaque);
        const transparent = this.translateCmb(gl, mesh.transparent);

        return () => {
            opaque();
            // transparent();
        };
    }

    render(state:Viewer.RenderState) {
        const gl = state.viewport.gl;

        state.useProgram(this.program);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        this.model();
    }
}

class MultiScene implements Viewer.Scene {
    scenes:Viewer.Scene[];
    textures:HTMLCanvasElement[];
    constructor(scenes:Viewer.Scene[]) {
        this.scenes = scenes;
        this.textures = [];
        for (const scene of this.scenes)
            this.textures = this.textures.concat(scene.textures);
    }
    render(renderState:Viewer.RenderState) {
        this.scenes.forEach((scene) => scene.render(renderState));
    }
}

function dirname(path:string):string {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
}

export class SceneDesc implements Viewer.SceneDesc {
    name:string;
    path:string;

    constructor(name:string, path:string) {
        this.name = name;
        this.path = path;
    }

    _createSceneFromData(gl:WebGLRenderingContext, result:ArrayBuffer):PromiseLike<Viewer.Scene> {
        const zsi = ZSI.parse(result);
        if (zsi.mesh) {
            return Promise.resolve(new Scene(gl, zsi));
        } else if (zsi.rooms) {
            const basePath = dirname(this.path);
            const roomFilenames = zsi.rooms.map((romPath) => {
                const filename = romPath.split('/').pop();
                return basePath + '/' + filename;
            });

            return Promise.all(roomFilenames.map((filename) => {
                return fetch(filename).then((result) => this._createSceneFromData(gl, result));
            })).then((scenes) => {
                return new MultiScene(scenes);
            });
        }
    }

    createScene(gl:WebGLRenderingContext):PromiseLike<Viewer.Scene> {
        return fetch(this.path).then((result:ArrayBuffer) => {
            return this._createSceneFromData(gl, result);
        });
    }
}
