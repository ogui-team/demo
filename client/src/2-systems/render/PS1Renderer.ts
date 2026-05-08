import * as THREE from 'three';

export class PS1Renderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;

  init(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // PS1 aesthetic
      powerPreference: 'high-performance',
    });

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.setSize(window.innerWidth, window.innerHeight);

    // Apply PS1-style shader if desired (optional, for now using basic materials)
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height);
  }
}
