
import { BMD, BTK } from './j3d';

import * as RARC from './rarc';
import * as Yaz0 from '../yaz0';
import * as GX_Material from './gx_material';
import * as Viewer from '../viewer';
import { MultiScene, RARCSceneDesc } from './scenes';
import { Scene } from './render';

import { Progressable } from '../progress';
import { fetch, readString } from '../util';

class WindWakerScene extends MultiScene {
    public roomIdx: number;
    public stageRarc: RARC.RARC;
    public roomRarc: RARC.RARC;

    public model: Scene;
    public model1: Scene;
    public model3: Scene;

    public vr_sky: Scene;
    public vr_uso_umi: Scene;
    public vr_kasumi_mae: Scene;
    public vr_back_cloud: Scene;

    static getColorsFromDZS(buffer: ArrayBuffer, roomIdx: number, timeOfDay: number) {
        const view = new DataView(buffer);
        const chunkCount = view.getUint32(0x00);

        const chunkOffsets = new Map<string, number>();
        let chunkTableIdx = 0x04;
        for (let i = 0; i < chunkCount; i++) {
            const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
            const offs = view.getUint32(chunkTableIdx + 0x08);
            chunkOffsets.set(type, offs);
            chunkTableIdx += 0x0C;
        }

        const coloIdx = view.getUint8(chunkOffsets.get('EnvR') + (roomIdx * 0x08));
        const coloOffs = chunkOffsets.get('Colo') + (coloIdx * 0x0C);
        const whichPale = timeOfDay;
        const paleIdx = view.getUint8(coloOffs + whichPale);
        const paleOffs = chunkOffsets.get('Pale') + (paleIdx * 0x2C);
        const virtIdx = view.getUint8(paleOffs + 0x21);
        const virtOffs = chunkOffsets.get('Virt') + (virtIdx * 0x24);

        const ambR = view.getUint8(paleOffs + 0x06) / 0xFF;
        const ambG = view.getUint8(paleOffs + 0x07) / 0xFF;
        const ambB = view.getUint8(paleOffs + 0x08) / 0xFF;
        const amb = new GX_Material.Color(ambR, ambG, ambB, 1);

        const lightR = view.getUint8(paleOffs + 0x09) / 0xFF;
        const lightG = view.getUint8(paleOffs + 0x0A) / 0xFF;
        const lightB = view.getUint8(paleOffs + 0x0B) / 0xFF;
        const light = new GX_Material.Color(lightR, lightG, lightB, 1);

        const waveR = view.getUint8(paleOffs + 0x0C) / 0xFF;
        const waveG = view.getUint8(paleOffs + 0x0D) / 0xFF;
        const waveB = view.getUint8(paleOffs + 0x0E) / 0xFF;
        const wave = new GX_Material.Color(waveR, waveG, waveB, 1);

        const oceanR = view.getUint8(paleOffs + 0x0F) / 0xFF;
        const oceanG = view.getUint8(paleOffs + 0x10) / 0xFF;
        const oceanB = view.getUint8(paleOffs + 0x11) / 0xFF;
        const ocean = new GX_Material.Color(oceanR, oceanG, oceanB, 1);

        const splashR = view.getUint8(paleOffs + 0x12) / 0xFF;
        const splashG = view.getUint8(paleOffs + 0x13) / 0xFF;
        const splashB = view.getUint8(paleOffs + 0x14) / 0xFF;
        const splash = new GX_Material.Color(splashR, splashG, splashB, 1);

        const doorsR = view.getUint8(paleOffs + 0x18) / 0xFF;
        const doorsG = view.getUint8(paleOffs + 0x19) / 0xFF;
        const doorsB = view.getUint8(paleOffs + 0x1A) / 0xFF;
        const doors = new GX_Material.Color(doorsR, doorsG, doorsB, 1);

        const vr_back_cloudR = view.getUint8(virtOffs + 0x10) / 0xFF;
        const vr_back_cloudG = view.getUint8(virtOffs + 0x11) / 0xFF;
        const vr_back_cloudB = view.getUint8(virtOffs + 0x12) / 0xFF;
        const vr_back_cloudA = view.getUint8(virtOffs + 0x13) / 0xFF;
        const vr_back_cloud = new GX_Material.Color(vr_back_cloudR, vr_back_cloudG, vr_back_cloudB, vr_back_cloudA);

        const vr_skyR = view.getUint8(virtOffs + 0x18) / 0xFF;
        const vr_skyG = view.getUint8(virtOffs + 0x19) / 0xFF;
        const vr_skyB = view.getUint8(virtOffs + 0x1A) / 0xFF;
        const vr_sky = new GX_Material.Color(vr_skyR, vr_skyG, vr_skyB, 1);

        const vr_uso_umiR = view.getUint8(virtOffs + 0x1B) / 0xFF;
        const vr_uso_umiG = view.getUint8(virtOffs + 0x1C) / 0xFF;
        const vr_uso_umiB = view.getUint8(virtOffs + 0x1D) / 0xFF;
        const vr_uso_umi = new GX_Material.Color(vr_uso_umiR, vr_uso_umiG, vr_uso_umiB, 1);

        const vr_kasumi_maeG = view.getUint8(virtOffs + 0x1F) / 0xFF;
        const vr_kasumi_maeR = view.getUint8(virtOffs + 0x1E) / 0xFF;
        const vr_kasumi_maeB = view.getUint8(virtOffs + 0x20) / 0xFF;
        const vr_kasumi_mae = new GX_Material.Color(vr_kasumi_maeR, vr_kasumi_maeG, vr_kasumi_maeB, 1);

        return { amb, light, wave, ocean, splash, doors, vr_back_cloud, vr_sky, vr_uso_umi, vr_kasumi_mae };
    }

    constructor(gl: WebGL2RenderingContext, roomIdx: number, stageRarc: RARC.RARC, roomRarc: RARC.RARC) {
        super([]);

        this.roomIdx = roomIdx;
        this.stageRarc = stageRarc;
        this.roomRarc = roomRarc;

        function createScene(rarc: RARC.RARC, name: string, isSkybox: boolean): Scene {
            const bdlFile = rarc.findFile(`bdl/${name}.bdl`);
            if (!bdlFile)
                return null;
            const btkFile = rarc.findFile(`btk/${name}.btk`);
            const bdl = BMD.parse(bdlFile.buffer);
            const btk = btkFile ? BTK.parse(btkFile.buffer) : null;
            return new Scene(gl, bdl, btk, null, isSkybox);
        }

        const scenes = [];

        // Skybox.
        this.vr_sky = createScene(stageRarc, `vr_sky`, true);
        scenes.push(this.vr_sky);
        this.vr_kasumi_mae = createScene(stageRarc, `vr_kasumi_mae`, true);
        scenes.push(this.vr_kasumi_mae);
        this.vr_uso_umi = createScene(stageRarc, `vr_uso_umi`, true);
        scenes.push(this.vr_uso_umi);
        this.vr_back_cloud = createScene(stageRarc, `vr_back_cloud`, true);
        scenes.push(this.vr_back_cloud);

        this.model = createScene(roomRarc, `model`, false);
        scenes.push(this.model);

        // Ocean.
        this.model1 = createScene(roomRarc, `model1`, false);
        if (this.model1)
            scenes.push(this.model1);

        // Windows / doors.
        this.model3 = createScene(roomRarc, `model3`, false);
        if (this.model3)
            scenes.push(this.model3);

        // Noon.
        this.setTimeOfDay(0x02);

        super(scenes);
    }

    public setTimeOfDay(timeOfDay: number) {
        const dzsFile = this.stageRarc.findFile(`dzs/stage.dzs`);
        const colors = WindWakerScene.getColorsFromDZS(dzsFile.buffer, this.roomIdx, timeOfDay);

        this.model.setKonstColorOverride(0, colors.light);
        this.model.setKonstColorOverride(4, colors.amb);

        if (this.model1) {
            this.model1.setKonstColorOverride(0, colors.ocean);
            this.model1.setKonstColorOverride(4, colors.wave);
            this.model1.setKonstColorOverride(5, colors.splash);
        }
        if (this.model3)
            this.model3.setKonstColorOverride(4, colors.doors);

        this.vr_sky.setKonstColorOverride(0, colors.vr_sky);
        this.vr_uso_umi.setKonstColorOverride(0, colors.vr_uso_umi);
        this.vr_kasumi_mae.setKonstColorOverride(4, colors.vr_kasumi_mae);
        this.vr_back_cloud.setKonstColorOverride(0, colors.vr_back_cloud);
    }
}

class WindWakerSceneDesc extends RARCSceneDesc {
    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const roomIdx = parseInt(this.path.match(/Room(\d+)/)[1], 10);

        return Progressable.all([
            fetch(`data/j3d/ww/sea/Stage.arc`),
            fetch(this.path),
        ]).then(([stage, room]) => {
            const stageRarc = RARC.parse(Yaz0.decompress(stage));
            const roomRarc = RARC.parse(room);
            return new WindWakerScene(gl, roomIdx, stageRarc, roomRarc);
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new WindWakerSceneDesc("data/j3d/ww/sea/Room11.arc", "Windfall Island"),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room13.arc", "Dragon Roost Island"),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room41.arc", "Forest Haven"),
    new WindWakerSceneDesc("data/j3d/ww/sea/Room44.arc", "Outset Island"),
]

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
