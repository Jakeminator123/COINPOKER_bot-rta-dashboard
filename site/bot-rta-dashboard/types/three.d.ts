declare module 'three' {
  const THREE: any;
  export = THREE;
  export as namespace THREE;
  namespace THREE {
    export class Clock {}
    export class Scene {}
    export class PerspectiveCamera {}
    export class WebGLRenderer {}
    export class AmbientLight {}
    export class DirectionalLight {}
    export class Box3 {}
    export class Vector3 {}
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export class GLTFLoader {
    load(url: string, onLoad?: (gltf: any) => void, onProgress?: (progress: any) => void, onError?: (error: any) => void): void;
  }
}

declare module 'three/examples/jsm/loaders/GLTFLoader' {
  export class GLTFLoader {
    load(url: string, onLoad?: (gltf: any) => void, onProgress?: (progress: any) => void, onError?: (error: any) => void): void;
  }
}

