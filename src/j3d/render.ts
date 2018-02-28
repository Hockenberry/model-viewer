
import { mat3, mat4 } from 'gl-matrix';

import { BMD, BTK, BMT, TEX1_Texture, Shape, HierarchyNode, HierarchyType } from './j3d';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from 'viewer';

import { RenderFlags, RenderState, RenderPass } from '../render';

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): { type: GLenum, normalized: boolean } {
    switch (compType) {
    case GX.CompType.F32:
        return { type: gl.FLOAT, normalized: false };
    case GX.CompType.S8:
        return { type: gl.BYTE, normalized: false };
    case GX.CompType.S16:
        return { type: gl.SHORT, normalized: false };
    case GX.CompType.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case GX.CompType.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case GX.CompType.RGBA8: // XXX: Is this right?
        return { type: gl.UNSIGNED_BYTE, normalized: true };
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

function translatePrimType(gl: WebGL2RenderingContext, primType: GX.PrimitiveType): number {
    switch (primType) {
    case GX.PrimitiveType.TRIANGLESTRIP:
        return gl.TRIANGLE_STRIP;
    case GX.PrimitiveType.TRIANGLEFAN:
        return gl.TRIANGLE_FAN;
    default:
        throw new Error(`Unknown PrimType ${primType}`);
    }
}

const posMtxTable = new Float32Array(16 * 10);
class Command_Shape {
    private bmd: BMD;
    private shape: Shape;
    private vao: WebGLVertexArrayObject;
    private vertexBuffer: WebGLBuffer;
    private indexBuffer: WebGLBuffer;
    private jointMatrices: mat4[];
    private numTriangles: number;

    constructor(gl: WebGL2RenderingContext, bmd: BMD, shape: Shape, jointMatrices: mat4[]) {
        this.bmd = bmd;
        this.shape = shape;
        this.jointMatrices = jointMatrices;

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.shape.packedData, gl.STATIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.shape.indexData, gl.STATIC_DRAW);

        for (const attrib of this.shape.packedVertexAttributes) {
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);

            const attribLocation = attrib.vtxAttrib;
            gl.enableVertexAttribArray(attribLocation);

            const { type, normalized } = translateCompType(gl, vertexArray.compType);

            gl.vertexAttribPointer(
                attribLocation,
                vertexArray.compCount,
                type, normalized,
                this.shape.packedVertexSize,
                attrib.offset,
            );
        }
    }

    public exec(state: RenderState) {
        const gl = state.gl;
        const prog = (<GX_Material.GX_Program> state.currentProgram);

        gl.bindVertexArray(this.vao);

        this.shape.packets.forEach((packet, packetIndex) => {
            // Update our matrix table.
            for (let i = 0; i < packet.weightedJointTable.length; i++) {
                const weightedJointIndex = packet.weightedJointTable[i];
                // Leave existing joint.
                if (weightedJointIndex === 0xFFFF)
                    continue;
                const weightedJoint = this.bmd.drw1.weightedJoints[weightedJointIndex];
                if (weightedJoint.isWeighted)
                    throw "whoops";

                const posMtx = this.jointMatrices[weightedJoint.jointIndex];
                posMtxTable.set(posMtx, i * 16);
            }
            gl.uniformMatrix4fv(prog.posMtxLocation, false, posMtxTable);

            gl.drawElements(gl.TRIANGLES, packet.numTriangles * 3, gl.UNSIGNED_SHORT, packet.firstTriangle * 3);
        });

        gl.bindVertexArray(null);
    }

    public destroy(gl: WebGL2RenderingContext) {
        gl.deleteVertexArray(this.vao);
        gl.deleteBuffer(this.indexBuffer);
        gl.deleteBuffer(this.vertexBuffer);
    }
}

class Command_Material {
    public bmd: BMD;
    public btk: BTK;
    public bmt: BMT;
    public material: GX_Material.GXMaterial;

    private textures: WebGLTexture[] = [];
    private renderFlags: RenderFlags;
    private program: GX_Material.GX_Program;

    constructor(gl: WebGL2RenderingContext, bmd: BMD, btk: BTK, bmt: BMT, material: GX_Material.GXMaterial) {
        this.bmd = bmd;
        this.btk = btk;
        this.bmt = bmt;
        this.material = material;
        this.program = new GX_Material.GX_Program(material);
        this.renderFlags = GX_Material.translateRenderFlags(this.material);

        this.textures = this.translateTextures(gl);
    }

    private translateTextures(gl: WebGL2RenderingContext): WebGLTexture[] {
        const tex1 = this.bmt ? this.bmt.tex1 : this.bmd.tex1;
        const textures = [];
        for (let i = 0; i < this.material.textureIndexes.length; i++) {
            const texIndex = this.material.textureIndexes[i];
            if (texIndex >= 0)
                textures[i] = Command_Material.translateTexture(gl, tex1.textures[texIndex]);
            else
                textures[i] = null;
        }
        return textures;
    }

    private static translateTexFilter(gl: WebGL2RenderingContext, texFilter: GX.TexFilter) {
        switch (texFilter) {
        case GX.TexFilter.LIN_MIP_NEAR:
            return gl.LINEAR_MIPMAP_NEAREST;
        case GX.TexFilter.LIN_MIP_LIN:
            return gl.LINEAR_MIPMAP_LINEAR;
        case GX.TexFilter.LINEAR:
            return gl.LINEAR;
        case GX.TexFilter.NEAR_MIP_NEAR:
            return gl.NEAREST_MIPMAP_NEAREST;
        case GX.TexFilter.NEAR_MIP_LIN:
            return gl.NEAREST_MIPMAP_LINEAR;
        case GX.TexFilter.NEAR:
            return gl.NEAREST;
        }
    }

    private static translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode) {
        switch (wrapMode) {
        case GX.WrapMode.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX.WrapMode.MIRROR:
            return gl.MIRRORED_REPEAT;
        case GX.WrapMode.REPEAT:
            return gl.REPEAT;
        }
    }

    private static translateTexture(gl: WebGL2RenderingContext, texture: TEX1_Texture) {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, texture.minFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, texture.magFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, texture.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, texture.wrapT));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, texture.mipCount - 1);

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const name = texture.name;
        const format = texture.format;

        let offs = 0, width = texture.width, height = texture.height;
        for (let i = 0; i < texture.mipCount; i++) {
            const size = GX_Texture.calcTextureSize(format, width, height);
            const data = texture.data.slice(offs, offs + size);
            const surface = { name, format, width, height, data };
            const decodedTexture = GX_Texture.decodeTexture(surface, !!ext_compressed_texture_s3tc);

            if (decodedTexture.type === 'RGBA') {
                gl.texImage2D(gl.TEXTURE_2D, i, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
            } else if (decodedTexture.type === 'S3TC') {
                gl.compressedTexImage2D(gl.TEXTURE_2D, i, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
            }

            offs += size;
            width /= 2;
            height /= 2;
        }

        return texId;
    }

    public exec(state: RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);
        state.useFlags(this.renderFlags);

        // LOD Bias.
        const width = state.viewport.canvas.width;
        const height = state.viewport.canvas.height;
        // GC's internal EFB is sized at 640x528. Bias our mips so that it's like the user
        // is rendering things in that resolution.
        const bias = Math.log2(Math.min(width / 640, height / 528));
        gl.uniform1f(this.program.texLodBiasLocation, bias);

        // Bind our scale uniforms.
        for (const vertexArray of this.bmd.vtx1.vertexArrays.values()) {
            const location = this.program.getScaleUniformLocation(vertexArray.vtxAttrib);
            if (location === null)
                continue;
            gl.uniform1f(location, vertexArray.scale);
        }

        // Bind our texture matrices.
        const matrix = mat3.create();
        for (let i = 0; i < this.material.texMatrices.length; i++) {
            const texMtx = this.material.texMatrices[i];
            if (texMtx === null)
                continue;

            if (!(this.btk && this.btk.applyAnimation(matrix, this.material.name, i, state.time)))
                mat3.copy(matrix, texMtx.matrix);

            const location = this.program.texMtxLocations[i];
            gl.uniformMatrix3fv(location, false, matrix);
        }

        for (let i = 0; i < this.textures.length; i++) {
            const texture = this.textures[i];
            if (texture === null)
                continue;
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.uniform1i(this.program.samplerLocations[i], i);
            gl.bindTexture(gl.TEXTURE_2D, texture);
        }
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.textures.forEach((texture) => gl.deleteTexture(texture));
        this.program.destroy(gl);
    }
}

type Command = Command_Shape | Command_Material;

interface HierarchyTraverseContext {
    commandList: Command[];
    parentJointMatrix: mat4;
}

export class Scene implements Viewer.Scene {
    public cameraController = Viewer.FPSCameraController;
    public renderPasses = [ RenderPass.OPAQUE, RenderPass.TRANSPARENT ];

    public gl: WebGL2RenderingContext;
    public textures: HTMLCanvasElement[];
    private bmd: BMD;
    private btk: BTK;
    private bmt: BMT;
    private opaqueCommands: Command[];
    private transparentCommands: Command[];

    private materialCommands: Command_Material[];
    private shapeCommands: Command_Shape[];
    private jointMatrices: mat4[];

    constructor(gl: WebGL2RenderingContext, bmd: BMD, btk: BTK, bmt: BMT) {
        this.gl = gl;
        this.bmd = bmd;
        this.btk = btk;
        this.bmt = bmt;
        this.translateModel(this.bmd);

        const tex1 = this.bmt ? this.bmt.tex1 : this.bmd.tex1;
        this.textures = tex1.textures.map((tex) => this.translateTextureToCanvas(tex));
    }

    private translateTextureToCanvas(texture: TEX1_Texture): HTMLCanvasElement {
        const rgbaTexture = GX_Texture.decodeTexture(texture, false);
        // Should never happen.
        if (rgbaTexture.type === 'S3TC')
            return null;
        const canvas = document.createElement('canvas');
        canvas.width = rgbaTexture.width;
        canvas.height = rgbaTexture.height;
        canvas.title = `${texture.name} ${texture.format}`;
        canvas.style.backgroundColor = 'black';
        const ctx = canvas.getContext('2d');
        const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
        imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    public render(state: RenderState) {
        state.setClipPlanes(10, 500000);

        let commands;
        if (state.currentPass === RenderPass.OPAQUE) {
            commands = this.opaqueCommands;
        } else if (state.currentPass === RenderPass.TRANSPARENT) {
            commands = this.transparentCommands;
        }

        commands.forEach((command) => {
            command.exec(state);
        });
    }

    private translateModel(bmd: BMD) {
        this.opaqueCommands = [];
        this.transparentCommands = [];
        this.jointMatrices = [];

        const mat3 = this.bmt ? this.bmt.mat3 : this.bmd.mat3;
        this.materialCommands = mat3.materialEntries.map((material) => {
            return new Command_Material(this.gl, this.bmd, this.btk, this.bmt, material);
        });
        this.shapeCommands = bmd.shp1.shapes.map((shape) => {
            return new Command_Shape(this.gl, this.bmd, shape, this.jointMatrices);
        });

        // Iterate through scene graph.
        const context: HierarchyTraverseContext = {
            commandList: null,
            parentJointMatrix: mat4.create(),
        };
        this.translateSceneGraph(bmd.inf1.sceneGraph, context);
    }

    private translateSceneGraph(node: HierarchyNode, context: HierarchyTraverseContext) {
        const mat3 = this.bmt ? this.bmt.mat3 : this.bmd.mat3;
        const jnt1 = this.bmd.jnt1;

        let commandList = context.commandList;
        let parentJointMatrix = context.parentJointMatrix;
        switch (node.type) {
        case HierarchyType.Shape:
            commandList.push(this.shapeCommands[node.shapeIdx]);
            break;
        case HierarchyType.Joint:
            const boneMatrix = jnt1.bones[jnt1.remapTable[node.jointIdx]].matrix;
            const jointMatrix = mat4.create();
            mat4.mul(jointMatrix, boneMatrix, parentJointMatrix);
            this.jointMatrices[node.jointIdx] = jointMatrix;
            parentJointMatrix = jointMatrix;
            break;
        case HierarchyType.Material:
            const materialIdx = mat3.remapTable[node.materialIdx];
            const materialCommand = this.materialCommands[materialIdx];
            commandList = materialCommand.material.translucent ? this.transparentCommands : this.opaqueCommands;
            commandList.push(materialCommand);
            break;
        }

        const childContext = { commandList, parentJointMatrix };

        for (const child of node.children)
            this.translateSceneGraph(child, childContext);
    }

    public destroy(gl: WebGL2RenderingContext) {
        this.materialCommands.forEach((command) => command.destroy(gl));
        this.shapeCommands.forEach((command) => command.destroy(gl));
    }
}
