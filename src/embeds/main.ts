
import { System } from 'systemjs';

import * as Viewer from 'viewer';
import { Progressable } from 'progress';

interface EmbedModule {
    createScene(gl: WebGL2RenderingContext, name: string): Progressable<Viewer.MainScene>;
}

class FsButton {
    public elem: HTMLElement;
    private hover: boolean = false;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.border = '1px solid rgba(255, 255, 255, 0.4)';
        this.elem.style.borderRadius = '4px';
        this.elem.style.color = 'white';
        this.elem.style.position = 'absolute';
        this.elem.style.bottom = '8px';
        this.elem.style.right = '8px';
        this.elem.style.width = '32px';
        this.elem.style.height = '32px';
        this.elem.style.font = '130% bold sans-serif';
        this.elem.style.textAlign = 'center';
        this.elem.style.cursor = 'pointer';
        this.elem.onmouseover = () => {
            this.hover = true;
            this.style();
        };
        this.elem.onmouseout = () => {
            this.hover = false;
            this.style();
        };
        this.elem.onclick = this.onClick.bind(this);
        document.addEventListener('fullscreenchange', this.style.bind(this));
        this.style();
    }

    private isFS() {
        return document.fullscreenElement === document.body;
    }

    private style() {
        this.elem.style.backgroundColor = this.hover ? 'rgba(50, 50, 50, 0.8)' : 'rgba(0, 0, 0, 0.8)';
        this.elem.textContent = this.isFS() ? '🡼' : '🡾';
    }

    onClick() {
        if (this.isFS())
            document.exitFullscreen();
        else
            document.body.requestFullscreen();
    }
}

class Main {
    private canvas: HTMLCanvasElement;
    private viewer: Viewer.Viewer;
    private fsButton: FsButton;

    constructor() {
        this.canvas = document.createElement('canvas');

        document.body.appendChild(this.canvas);
        window.onresize = this.onResize.bind(this);

        this.fsButton = new FsButton();
        document.body.appendChild(this.fsButton.elem);

        this.viewer = new Viewer.Viewer(this.canvas);
        this.viewer.start();

        // Dispatch to the main embed.
        const hash = window.location.hash.slice(1);

        this.onResize();
        this.loadScene(hash);
    }

    private loadScene(hash: string) {
        const [file, name] = hash.split('/');
        System.import(`embeds/${file}`).then((embedModule: EmbedModule) => {
            const gl = this.viewer.renderState.gl;
            embedModule.createScene(gl, name).then((scene: Viewer.MainScene) => {
                this.viewer.setScene(scene);
            });
        });
    }

    private onResize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private onFsButtonClick() {
    }
}

window.main = new Main();
