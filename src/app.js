import { TimingProfiler } from './timing.js';

export function startApp() {
    const THREE = window.THREE;
    const lil = window.lil;
    const CANNON = window.CANNON;

    // --- CORE SETUP & PARAMS ---
    const params = {
        enableGI: true, enableSSR: true, enableVolumetrics: true,
        escapeGI: true, escapeSSR: true,
        maxRayBrightness: 5.0,
        modelScale: 1.0,
        ceilingLight: true, movingLight: false,
        movingLightColor: [1.0, 0.2, 0.2], movingLightBrightness: 10.0,
        skyBrightness: 1.0,
        probeGiRes: 128, probeVolumeRes: 64, probePushOff: 1.0, probeSnapSize: 0.2, probeSSR: true, probeSSRRays: 2,
        probeStableDensity: 0.1, probeHistoryBlend: 0.7, probeHistoryDepthThreshold: 0.35, probeHistoryNormalThreshold: 0.82,
        cubeImportanceRatio: 0.6, cubeRays: 8, cubeSteps: 16, cubeStepSize: 0.5, cubeStepGrowth: 1.15, probeGIBounces: 2, probeBounceStrength: 0.12,
        sceneGiScale: 0.5, importanceRatio: 0.6, rays: 16, steps: 16, stepSize: 0.2, stepGrowth: 1.15, sceneGIBounces: 2, sceneBounceStrength: 0.5,
        sceneSsrScale: 0.25, ssrRays: 10, ssrSteps: 16,
        sceneVolumeScale: 0.25,
        volumetricIntensity: 1.0,
        volumetricViewSamples: 1, volumetricLightRays: 6,
        volumetricCubeSamples: 1,volumetricCubeLightRays: 1,
        volumetricSteps: 12, volumetricStepSize: 0.35, volumetricStepGrowth: 1.12,
        volumetricMaxDistance: 24.0, volumetricExtinction: 1.2, volumetricAlbedo: 0.9,
        heightFogColor: [1.0, 1.0, 1.0], heightFogDensity: 0.1, heightFogHeight: -3.5, heightFogFalloff: 0.87,
        defaultVolumeDensity: 0.35,
        giDenoiseRadius: 3, giDenoisePasses: 2, giDenoiseStrength: 0.95, giDenoiseDepthWeight: 12.0, giDenoiseNormWeight: 5.0, giDenoiseLumaClamp: 1.2,
        ssrDenoiseRadius: 3, ssrDenoisePasses: 2, ssrDenoiseStrength: 0.88, ssrDenoiseDepthWeight: 14.0, ssrDenoiseNormWeight: 5.0, ssrDenoiseRoughWeight: 3.5, ssrDenoiseLumaClamp: 1.18,
        volumeDenoiseRadius: 4, volumeDenoisePasses: 3, volumeDenoiseStrength: 0.92, volumeDenoiseDepthWeight: 16.0, volumeDenoiseNormWeight: 2.5, volumeDenoiseLumaClamp: 1.1,
        giTemporalEnabled: true, giTemporalBlend: 0.82, giTemporalBlendLow: 0.92, giTemporalDepthThreshold: 0.5, giTemporalNormalThreshold: 0.75, giTemporalNeighborhoodClamp: 1.15,
        ssrTemporalEnabled: true, ssrTemporalBlend: 0.7, ssrTemporalBlendLow: 0.8, ssrTemporalDepthThreshold: 0.45, ssrTemporalNormalThreshold: 0.72, ssrTemporalNeighborhoodClamp: 1.15, ssrTemporalRoughnessThreshold: 0.18,
        volumeTemporalEnabled: true, volumeTemporalBlend: 0.96, volumeTemporalBlendLow: 0.98, volumeTemporalDepthThreshold: 0.6, volumeTemporalNormalThreshold: 0.55, volumeTemporalNeighborhoodClamp: 1.12,
        upsampleJitter: 0.5,
        occlusionBias: 1.5, occlusionMaxBoost: 2.0,
        brightnessCompensationStrength: 0.0, brightnessCompensationClamp: 0.25,
        showRawGI: false, showRawVolume: false, showCubemap: false, showTimings: true
    };

    let frameIndex = 0;
    let sampleEpoch = 0;
    let temporalHistoryValid = false;
    const previousCameraPos = new THREE.Vector3();
    const snappedProbePos = new THREE.Vector3();

    function halton(index, base) {
        let result = 0.0;
        let f = 1.0 / base;
        let i = index;
        while (i > 0) {
            result += f * (i % base);
            i = Math.floor(i / base);
            f /= base;
        }
        return result;
    }

    function nextFrameSeed(offset = 0) {
        const idx = frameIndex + 1 + offset;
        return (halton(idx, 2) + halton(idx, 3) * 0.5 + halton(idx, 5) * 0.25) % 1.0;
    }

    function truncateToGrid(value, gridSize) {
        if (gridSize <= 0.0) return value;
        return Math.trunc(value / gridSize) * gridSize;
    }

    function snapVectorToGrid(target, gridSize, out) {
        out.set(
            truncateToGrid(target.x, gridSize),
            truncateToGrid(target.y, gridSize),
            truncateToGrid(target.z, gridSize)
        );
        return out;
    }

    function invalidateProbeSampling() {
        sampleEpoch = (sampleEpoch + 1) % 1048576;
        temporalHistoryValid = false;
    }

    function invalidateTemporalHistory() {
        temporalHistoryValid = false;
    }

    function invalidateAllHistory() {
        invalidateProbeSampling();
    }

    const gui = new lil.GUI();

    const featuresFolder = gui.addFolder('Features & Settings');
    featuresFolder.add(params, 'enableGI').name('Enable Global Illum.').onChange(invalidateTemporalHistory);
    featuresFolder.add(params, 'enableSSR').name('Enable Reflections').onChange(invalidateTemporalHistory);
    featuresFolder.add(params, 'enableVolumetrics').name('Enable Volumetrics').onChange(invalidateTemporalHistory);
    featuresFolder.add(params, 'escapeGI').name('GI Env. Escape').onChange(invalidateTemporalHistory);
    featuresFolder.add(params, 'escapeSSR').name('SSR Env. Escape').onChange(invalidateTemporalHistory);
    featuresFolder.add(params, 'maxRayBrightness', 1.0, 50.0).name('Max Ray Brightness').onChange(invalidateAllHistory);
    featuresFolder.add(params, 'modelScale', 0.1, 20.0, 0.1).name('Model Scale').onChange(updateModelScale);

    const uploadObj = {
        loadFile: () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.glb,.gltf';
            input.onchange = e => {
                const file = e.target.files[0];
                if(!file) return;
                const url = URL.createObjectURL(file);
                loadModel(url);
            };
            input.click();
        },
        loadHDRI: () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.hdr';
            input.onchange = e => {
                const file = e.target.files[0];
                if(!file) return;
                const url = URL.createObjectURL(file);
                loadHDRI(url);
            };
            input.click();
        }
    };
    featuresFolder.add(uploadObj, 'loadFile').name('Upload .GLB Model');
    featuresFolder.add(uploadObj, 'loadHDRI').name('Upload HDRI (.hdr)');

    const lightFolder = gui.addFolder('Lighting Toggles');
    lightFolder.add(params, 'skyBrightness', 0.1, 10.0).name('HDRI Brightness').onChange(v => {
        if(skyMesh) {
            const color = new THREE.Color(0xffffff).multiplyScalar(v);
            skyMesh.userData.mats.screenColor.uniforms.uEmissive.value.copy(color);
            skyMesh.userData.mats.stocColor.uniforms.uEmissive.value.copy(color);
        }
        invalidateAllHistory();
    });
    lightFolder.add(params, 'ceilingLight').name('Ceiling Light').onChange(v => { if(ceilingLightMesh) ceilingLightMesh.visible = v; invalidateAllHistory(); });
    lightFolder.add(params, 'movingLight').name('Moving Light').onChange(invalidateAllHistory);
    lightFolder.addColor(params, 'movingLightColor').name('Moving Color').onChange(invalidateAllHistory);
    lightFolder.add(params, 'movingLightBrightness', 0.1, 40.0).name('Moving Brightness').onChange(invalidateAllHistory);

    const gatherFolder = gui.addFolder('Screen GI');
    gatherFolder.add(params, 'sceneGiScale', [0.25, 0.5, 0.75, 1.0]).name('Resolution').onChange(resizeRenderTargets);
    gatherFolder.add(params, 'importanceRatio', 0.0, 0.9, 0.05).name('Importance Rays %').onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'rays', 1, 64, 1).onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'steps', 1, 64, 1).onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'stepSize', 0.05, 1.0).name('Step Size').onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'stepGrowth', 1.0, 1.5).name('Step Growth').onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'sceneGIBounces', 1, 8, 1).name('Bounces').onChange(invalidateTemporalHistory);
    gatherFolder.add(params, 'sceneBounceStrength', 0.02, 0.5, 0.01).name('Bounce Strength').onChange(invalidateTemporalHistory);

    const ssrFolder = gui.addFolder('Screen SSR');
    ssrFolder.add(params, 'sceneSsrScale', [0.25, 0.5, 0.75, 1.0]).name('Resolution').onChange(resizeRenderTargets);
    ssrFolder.add(params, 'ssrRays', 1, 64, 1).name('Rays').onChange(invalidateTemporalHistory);
    ssrFolder.add(params, 'ssrSteps', 1, 64, 1).name('Steps').onChange(invalidateTemporalHistory);

    const volumetricFolder = gui.addFolder('Volumetrics');
    volumetricFolder.add(params, 'sceneVolumeScale', [0.125, 0.25, 0.5, 0.75, 1.0]).name('Resolution').onChange(resizeRenderTargets);
    volumetricFolder.add(params, 'volumetricIntensity', 0.0, 4.0, 0.05).name('Intensity');
    volumetricFolder.add(params, 'volumetricViewSamples', 1, 24, 1).name('Screen Samples').onChange(invalidateTemporalHistory);
    volumetricFolder.add(params, 'volumetricLightRays', 1, 16, 1).name('Sample Rays').onChange(invalidateTemporalHistory);
    volumetricFolder.add(params, 'volumetricCubeSamples', 1, 24, 1).name('Cube Samples').onChange(invalidateProbeSampling);
    volumetricFolder.add(params, 'volumetricCubeLightRays', 1, 16, 1).name('Cube Sample Rays').onChange(invalidateProbeSampling);
    volumetricFolder.add(params, 'volumetricSteps', 1, 32, 1).name('Trace Steps').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'volumetricStepSize', 0.05, 1.5, 0.05).name('Step Size').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'volumetricStepGrowth', 1.0, 1.5, 0.01).name('Step Growth').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'volumetricMaxDistance', 1.0, 64.0, 0.5).name('Max Distance').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'volumetricExtinction', 0.1, 4.0, 0.05).name('Extinction').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'volumetricAlbedo', 0.0, 1.0, 0.01).name('Albedo').onChange(invalidateAllHistory);
    volumetricFolder.add(params, 'defaultVolumeDensity', 0.01, 2.0, 0.01).name('Default Volume Density').onChange(invalidateAllHistory);

    const fogFolder = gui.addFolder('Height Fog');
    fogFolder.addColor(params, 'heightFogColor').name('Color').onChange(invalidateAllHistory);
    fogFolder.add(params, 'heightFogDensity', 0.0, 0.25, 0.001).name('Density').onChange(invalidateAllHistory);
    fogFolder.add(params, 'heightFogHeight', -10.0, 10.0, 0.1).name('Height').onChange(invalidateAllHistory);
    fogFolder.add(params, 'heightFogFalloff', 0.0, 2.0, 0.01).name('Falloff').onChange(invalidateAllHistory);

    const probeFolder = gui.addFolder('Probe Lighting');
    probeFolder.add(params, 'probeGiRes', [64, 128, 256, 512, 1024]).name('GI Resolution').onChange(rebuildCubemaps);
    probeFolder.add(params, 'probeVolumeRes', [32, 64, 128, 256, 512]).name('Volume Resolution').onChange(rebuildCubemaps);
    probeFolder.add(params, 'probePushOff', 0.0, 3.0).name('Wall Avoidance (m)').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeSnapSize', 0.0, 1.0, 0.01).name('Grid Snap Size').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeSSR').name('Probe Reflection').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeSSRRays', 1, 16, 1).name('Reflection Rays').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'cubeRays', 1, 64, 1).name('GI Rays').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'cubeImportanceRatio', 0.0, 0.9, 0.05).name('Importance %').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'cubeSteps', 1, 64, 1).name('Steps').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'cubeStepSize', 0.05, 1.0).name('Step Size').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'cubeStepGrowth', 1.0, 1.5).name('Step Growth').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeGIBounces', 1, 8, 1).name('Ray Bounces').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeBounceStrength', 0.02, 0.5, 0.01).name('Bounce Strength').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeStableDensity', 0.1, 1.0, 0.05).name('Stochastic distribution').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeHistoryBlend', 0.0, 1.0, 0.01).name('History Blend').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeHistoryDepthThreshold', 0.05, 2.0, 0.01).name('Hist. Depth').onChange(invalidateProbeSampling);
    probeFolder.add(params, 'probeHistoryNormalThreshold', 0.0, 1.0, 0.01).name('Hist. Normal').onChange(invalidateProbeSampling);

    const stabilityFolder = gui.addFolder('Stability & Correction');
    stabilityFolder.add(params, 'occlusionBias', 0.0, 3.0, 0.01).name('Occlusion Bias').onChange(invalidateProbeSampling);
    stabilityFolder.add(params, 'occlusionMaxBoost', 1.0, 5.0, 0.05).name('Occ. Max Boost').onChange(invalidateProbeSampling);
    stabilityFolder.add(params, 'brightnessCompensationStrength', 0.0, 1.0, 0.01).name('Brightness Hold').onChange(invalidateProbeSampling);
    stabilityFolder.add(params, 'brightnessCompensationClamp', 0.0, 1.0, 0.01).name('Hold Clamp').onChange(invalidateProbeSampling);
    stabilityFolder.add(params, 'upsampleJitter', 0.0, 3.0).name('Filter Jitter');

    const giDenoiseFolder = gui.addFolder('GI Denoise');
    giDenoiseFolder.add(params, 'giDenoiseRadius', 0, 16, 1).name('Filter Radius');
    giDenoiseFolder.add(params, 'giDenoisePasses', 0, 4, 1).name('Filter Passes');
    giDenoiseFolder.add(params, 'giDenoiseStrength', 0.0, 1.0, 0.01).name('Strength');
    giDenoiseFolder.add(params, 'giDenoiseDepthWeight', 0.1, 50.0).name('Depth Weight');
    giDenoiseFolder.add(params, 'giDenoiseNormWeight', 0.1, 10.0).name('Normal Weight');
    giDenoiseFolder.add(params, 'giDenoiseLumaClamp', 1.0, 2.0, 0.01).name('Luma Clamp');

    const ssrDenoiseFolder = gui.addFolder('SSR Denoise');
    ssrDenoiseFolder.add(params, 'ssrDenoiseRadius', 0, 16, 1).name('Filter Radius');
    ssrDenoiseFolder.add(params, 'ssrDenoisePasses', 0, 4, 1).name('Filter Passes');
    ssrDenoiseFolder.add(params, 'ssrDenoiseStrength', 0.0, 1.0, 0.01).name('Strength');
    ssrDenoiseFolder.add(params, 'ssrDenoiseDepthWeight', 0.1, 50.0).name('Depth Weight');
    ssrDenoiseFolder.add(params, 'ssrDenoiseNormWeight', 0.1, 10.0).name('Normal Weight');
    ssrDenoiseFolder.add(params, 'ssrDenoiseRoughWeight', 0.0, 6.0, 0.1).name('Rough Weight');
    ssrDenoiseFolder.add(params, 'ssrDenoiseLumaClamp', 1.0, 2.0, 0.01).name('Luma Clamp');

    const volumeDenoiseFolder = gui.addFolder('Volume Denoise');
    volumeDenoiseFolder.add(params, 'volumeDenoiseRadius', 0, 16, 1).name('Filte Radius');
    volumeDenoiseFolder.add(params, 'volumeDenoisePasses', 0, 4, 1).name('Filter Passes');
    volumeDenoiseFolder.add(params, 'volumeDenoiseStrength', 0.0, 1.0, 0.01).name('Strength');
    volumeDenoiseFolder.add(params, 'volumeDenoiseDepthWeight', 0.1, 50.0).name('Depth Weight');
    volumeDenoiseFolder.add(params, 'volumeDenoiseNormWeight', 0.1, 10.0).name('Normal Weight');
    volumeDenoiseFolder.add(params, 'volumeDenoiseLumaClamp', 1.0, 2.0, 0.01).name('Luma Clamp');

    const giTemporalFolder = gui.addFolder('GI TAA');
    giTemporalFolder.add(params, 'giTemporalEnabled').name('Enabled');
    giTemporalFolder.add(params, 'giTemporalBlend', 0.0, 1.0, 0.01).name('History');
    giTemporalFolder.add(params, 'giTemporalBlendLow', 0.0, 1.0, 0.01).name('Low Light Hist.');
    giTemporalFolder.add(params, 'giTemporalDepthThreshold', 0.01, 2.0, 0.01).name('Depth Threshold');
    giTemporalFolder.add(params, 'giTemporalNormalThreshold', 0.0, 1.0, 0.01).name('Normal Threshold');
    giTemporalFolder.add(params, 'giTemporalNeighborhoodClamp', 1.0, 2.0, 0.01).name('Clamp');

    const ssrTemporalFolder = gui.addFolder('SSR TAA');
    ssrTemporalFolder.add(params, 'ssrTemporalEnabled').name('Enabled');
    ssrTemporalFolder.add(params, 'ssrTemporalBlend', 0.0, 1.0, 0.01).name('History');
    ssrTemporalFolder.add(params, 'ssrTemporalBlendLow', 0.0, 1.0, 0.01).name('Low Light Hist.');
    ssrTemporalFolder.add(params, 'ssrTemporalDepthThreshold', 0.01, 2.0, 0.01).name('Depth Threshold');
    ssrTemporalFolder.add(params, 'ssrTemporalNormalThreshold', 0.0, 1.0, 0.01).name('Normal Threshold');
    ssrTemporalFolder.add(params, 'ssrTemporalNeighborhoodClamp', 1.0, 2.0, 0.01).name('Clamp');
    ssrTemporalFolder.add(params, 'ssrTemporalRoughnessThreshold', 0.0, 0.5, 0.01).name('Roughness Thresh');

    const volumeTemporalFolder = gui.addFolder('Volume TAA');
    volumeTemporalFolder.add(params, 'volumeTemporalEnabled').name('Enabled');
    volumeTemporalFolder.add(params, 'volumeTemporalBlend', 0.0, 1.0, 0.01).name('History');
    volumeTemporalFolder.add(params, 'volumeTemporalBlendLow', 0.0, 1.0, 0.01).name('Low Light Hist.');
    volumeTemporalFolder.add(params, 'volumeTemporalDepthThreshold', 0.01, 2.0, 0.01).name('Depth Threshold');
    volumeTemporalFolder.add(params, 'volumeTemporalNormalThreshold', 0.0, 1.0, 0.01).name('Normal Threshold');
    volumeTemporalFolder.add(params, 'volumeTemporalNeighborhoodClamp', 1.0, 2.0, 0.01).name('Clamp');

    const debugFolder = gui.addFolder('Debug');
    debugFolder.add(params, 'showRawGI').name('Show GI Only');
    debugFolder.add(params, 'showRawVolume').name('Show Volumetric Only');
    debugFolder.add(params, 'showCubemap').name('Show Probe Cubemap');
    debugFolder.add(params, 'showTimings').name('Show Timings');

    //create camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, -1, 4);
    
    //create render context
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(1);
    document.body.appendChild(renderer.domElement);

    const timingProfiler = new TimingProfiler(renderer);
    const timingPanel = document.createElement('div');
    timingPanel.style.marginTop = '10px';
    timingPanel.style.fontSize = '12px';
    timingPanel.style.lineHeight = '1.35';
    timingPanel.style.display = params.showTimings ? 'block' : 'none';
    document.getElementById('ui').appendChild(timingPanel);

    function updateTimingPanel() {
        timingPanel.style.display = params.showTimings ? 'block' : 'none';
        if (!params.showTimings) return;
        const results = timingProfiler.getResults();
        const order = ['Probe GI Capture', 'Probe GI Trace', 'Probe SSR Trace', 'Scene GI Gather', 'Scene SSR Gather', 'Probe Volume Capture', 'Probe Volume Trace', 'Scene Volume Trace', 'Denoise/TAA Composite', 'Total'];
        timingPanel.innerHTML = order.map(name => `<div>${name}: ${(results[name] || 0).toFixed(2)} ms</div>`).join('');
    }
    
    const MAX_VOLUMES = 12;
    const MAX_VOLUME_VIEW_SAMPLES = 24;
    const MAX_VOLUME_LIGHT_RAYS = 16;
    
    function buildMatrix4Array(count) { return Array.from({ length: count }, () => new THREE.Matrix4()); }
    function buildVector3Array(count) { return Array.from({ length: count }, () => new THREE.Vector3()); }
    function buildVector4Array(count) { return Array.from({ length: count }, () => new THREE.Vector4()); }
    
    function taggedAsVolume(name) {
        return typeof name === 'string' && /(\[volume\]|(^|[_\-\s])volume([_\-\s]|$))/i.test(name);
    }
    
    function toThreeColor(value, fallback = new THREE.Color(0xffffff)) {
        if (value instanceof THREE.Color) return value.clone();
        if (Array.isArray(value)) {
            const scale = (value[0] > 1.0 || value[1] > 1.0 || value[2] > 1.0) ? (1.0 / 255.0) : 1.0;
            return new THREE.Color((value[0] || 0.0) * scale, (value[1] || 0.0) * scale, (value[2] || 0.0) * scale);
        }
        if (typeof value === 'number' || typeof value === 'string') return new THREE.Color(value);
        if (value && typeof value === 'object' && value.r !== undefined && value.g !== undefined && value.b !== undefined) {
            const scale = (value.r > 1.0 || value.g > 1.0 || value.b > 1.0) ? (1.0 / 255.0) : 1.0;
            return new THREE.Color(value.r * scale, value.g * scale, value.b * scale);
        }
        return fallback.clone();
    }
    
    const sharedVolumeUniforms = {
        uVolumeCount: { value: 0 },
        uVolumeWorldToLocal: { value: buildMatrix4Array(MAX_VOLUMES) },
        uVolumeBoundsMin: { value: buildVector3Array(MAX_VOLUMES) },
        uVolumeBoundsMax: { value: buildVector3Array(MAX_VOLUMES) },
        uVolumeColorDensity: { value: buildVector4Array(MAX_VOLUMES) },
        uHeightFogColor: { value: new THREE.Color(params.heightFogColor[0], params.heightFogColor[1], params.heightFogColor[2]) },
        uHeightFogDensity: { value: params.heightFogDensity },
        uHeightFogHeight: { value: params.heightFogHeight },
        uHeightFogFalloff: { value: params.heightFogFalloff },
        uVolumetricExtinction: { value: params.volumetricExtinction },
        uVolumetricAlbedo: { value: params.volumetricAlbedo },
        uVolumetricMaxDistance: { value: params.volumetricMaxDistance }
    };
    
    let volumeMeshes = [];
    let probeFrameCount = 0;
    let volumeFrameCount = 0;
    
    function getVolumeDescriptor(object3D, material) {
        const objectData = object3D.userData || {};
        const materialData = material && material.userData ? material.userData : {};
        const explicitVolume = objectData.isVolume === true || objectData.volume === true || objectData.renderAsVolume === true || materialData.isVolume === true || materialData.volume === true;
        const namedVolume = taggedAsVolume(object3D.name) || taggedAsVolume(material && material.name);
        if (!explicitVolume && !namedVolume) return null;
    
        const fallbackColor = material && material.color ? material.color : new THREE.Color(0xffffff);
        const hasDensity = objectData.volumeDensity !== undefined || materialData.volumeDensity !== undefined;
        return {
            color: toThreeColor(
                objectData.volumeColor !== undefined ? objectData.volumeColor :
                materialData.volumeColor !== undefined ? materialData.volumeColor :
                fallbackColor,
                fallbackColor
            ),
            density: Math.max(0.0, parseFloat(
                objectData.volumeDensity !== undefined ? objectData.volumeDensity :
                materialData.volumeDensity !== undefined ? materialData.volumeDensity :
                params.defaultVolumeDensity
            ) || 0.0),
            usesDefaultDensity: !hasDensity
        };
    }
    
    function refreshSharedVolumeUniforms() {
        sharedVolumeUniforms.uHeightFogColor.value.copy(toThreeColor(params.heightFogColor, sharedVolumeUniforms.uHeightFogColor.value));
        sharedVolumeUniforms.uHeightFogDensity.value = params.heightFogDensity;
        sharedVolumeUniforms.uHeightFogHeight.value = params.heightFogHeight;
        sharedVolumeUniforms.uHeightFogFalloff.value = params.heightFogFalloff;
        sharedVolumeUniforms.uVolumetricExtinction.value = params.volumetricExtinction;
        sharedVolumeUniforms.uVolumetricAlbedo.value = params.volumetricAlbedo;
        sharedVolumeUniforms.uVolumetricMaxDistance.value = params.volumetricMaxDistance;
    }
    
    function updateVolumeUniformState() {
        refreshSharedVolumeUniforms();
    
        let count = 0;
        for (let i = 0; i < volumeMeshes.length && count < MAX_VOLUMES; i++) {
            const mesh = volumeMeshes[i];
            if (!mesh || !mesh.geometry) continue;
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            if (!mesh.geometry.boundingBox) continue;
    
            mesh.updateMatrixWorld(true);
            sharedVolumeUniforms.uVolumeWorldToLocal.value[count].copy(mesh.matrixWorld).invert();
            sharedVolumeUniforms.uVolumeBoundsMin.value[count].copy(mesh.geometry.boundingBox.min);
            sharedVolumeUniforms.uVolumeBoundsMax.value[count].copy(mesh.geometry.boundingBox.max);
    
            const density = Math.max(0.0, mesh.userData.volumeUsesDefaultDensity ? params.defaultVolumeDensity : (mesh.userData.volumeDensity !== undefined ? mesh.userData.volumeDensity : params.defaultVolumeDensity));
            const color = toThreeColor(mesh.userData.volumeColor, new THREE.Color(0xffffff));
            sharedVolumeUniforms.uVolumeColorDensity.value[count].set(color.r, color.g, color.b, density);
            count++;
        }
    
        for (let i = count; i < MAX_VOLUMES; i++) {
            sharedVolumeUniforms.uVolumeWorldToLocal.value[i].identity();
            sharedVolumeUniforms.uVolumeBoundsMin.value[i].set(0.0, 0.0, 0.0);
            sharedVolumeUniforms.uVolumeBoundsMax.value[i].set(0.0, 0.0, 0.0);
            sharedVolumeUniforms.uVolumeColorDensity.value[i].set(0.0, 0.0, 0.0, 0.0);
        }
        sharedVolumeUniforms.uVolumeCount.value = count;
    }
    
    // Global probe positions
    const targetProbePos = new THREE.Vector3().copy(camera.position);
    const currentProbePos = new THREE.Vector3().copy(camera.position);
    const previousProbePos = new THREE.Vector3().copy(camera.position);
    snappedProbePos.copy(camera.position);
    let volumeProbeHistoryValid = false;
    let probeHistoryValid = false;
    let probeMotionAmount = 0.0;
    let brightnessCompensation = 1.0;
    const probeRaycaster = new THREE.Raycaster();

    // --- RENDER TARGETS ---
    const screenRTParams = { format: THREE.RGBAFormat, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    const cubeRTParams = { ...screenRTParams, generateMipmaps: false };
    const giRTParams = { format: THREE.RGBAFormat, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };

    let cubeColorRT_A, cubeNormalDistRT_A, cubeCamColor_A, cubeCamNormalDist_A;
    let cubeColorRT_B, cubeNormalDistRT_B, cubeCamColor_B, cubeCamNormalDist_B;
    let readCubeColorRT, readCubeNormalDistRT, writeCubeColorRT, writeCubeNormalDistRT, writeCubeCamColor, writeCubeCamNormalDist;
    let volumeCubeRT_A, volumeCubeRT_B, volumeCubeCam_A, volumeCubeCam_B;
    let readVolumeCubeRT, writeVolumeCubeRT, writeVolumeCubeCam;

    function getScaledDimensions(scale) {
        return [Math.max(1, Math.floor(window.innerWidth * scale)), Math.max(1, Math.floor(window.innerHeight * scale))];
    }

    function rebuildCubemaps() {
        if(cubeColorRT_A) {
            cubeColorRT_A.dispose(); cubeNormalDistRT_A.dispose();
            cubeColorRT_B.dispose(); cubeNormalDistRT_B.dispose();
        }
        if(volumeCubeRT_A) {
            volumeCubeRT_A.dispose(); volumeCubeRT_B.dispose();
        }
        const giRes = parseInt(params.probeGiRes, 10);
        const volumeRes = parseInt(params.probeVolumeRes, 10);
        cubeColorRT_A = new THREE.WebGLCubeRenderTarget(giRes, cubeRTParams);
        cubeNormalDistRT_A = new THREE.WebGLCubeRenderTarget(giRes, cubeRTParams);
        cubeCamColor_A = new THREE.CubeCamera(0.1, 500, cubeColorRT_A);
        cubeCamNormalDist_A = new THREE.CubeCamera(0.1, 500, cubeNormalDistRT_A);

        cubeColorRT_B = new THREE.WebGLCubeRenderTarget(giRes, cubeRTParams);
        cubeNormalDistRT_B = new THREE.WebGLCubeRenderTarget(giRes, cubeRTParams);
        cubeCamColor_B = new THREE.CubeCamera(0.1, 500, cubeColorRT_B);
        cubeCamNormalDist_B = new THREE.CubeCamera(0.1, 500, cubeNormalDistRT_B);

        volumeCubeRT_A = new THREE.WebGLCubeRenderTarget(volumeRes, cubeRTParams);
        volumeCubeRT_B = new THREE.WebGLCubeRenderTarget(volumeRes, cubeRTParams);
        volumeCubeCam_A = new THREE.CubeCamera(0.1, 500, volumeCubeRT_A);
        volumeCubeCam_B = new THREE.CubeCamera(0.1, 500, volumeCubeRT_B);

        readCubeColorRT = cubeColorRT_A; readCubeNormalDistRT = cubeNormalDistRT_A;
        writeCubeColorRT = cubeColorRT_B; writeCubeNormalDistRT = cubeNormalDistRT_B;
        writeCubeCamColor = cubeCamColor_B; writeCubeCamNormalDist = cubeCamNormalDist_B;

        readVolumeCubeRT = volumeCubeRT_A;
        writeVolumeCubeRT = volumeCubeRT_B;
        writeVolumeCubeCam = volumeCubeCam_B;
        sampleEpoch = (sampleEpoch + 1) % 1048576;
        probeFrameCount = 0;
        volumeFrameCount = 0;
        previousProbePos.copy(currentProbePos);
        volumeProbeHistoryValid = false;
        probeHistoryValid = false;
        temporalHistoryValid = false;
    }
    rebuildCubemaps();

    const screenColorRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, screenRTParams);
    const screenNormalDistRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, screenRTParams);
    const prevScreenColorRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, screenRTParams);
    const prevScreenNormalDistRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, screenRTParams);
    const giSize = new THREE.Vector2();
    const ssrSize = new THREE.Vector2();
    const volumeSize = new THREE.Vector2();

    let ssgiRT, denoiseRT, denoiseRTScratch, ssrRT, denoiseSsrRT, denoiseSsrRTScratch, volumetricRT, denoiseVolumeRT, denoiseVolumeRTScratch;
    let temporalRT_A, temporalRT_B, temporalSsrRT_A, temporalSsrRT_B, temporalVolumeRT_A, temporalVolumeRT_B;
    let readTemporalRT, writeTemporalRT, readTemporalSsrRT, writeTemporalSsrRT, readTemporalVolumeRT, writeTemporalVolumeRT;

    function initRenderTargets() {
        const [giW, giH] = getScaledDimensions(params.sceneGiScale);
        giSize.set(giW, giH);
        ssgiRT = new THREE.WebGLRenderTarget(giW, giH, giRTParams);
        denoiseRT = new THREE.WebGLRenderTarget(giW, giH, giRTParams);
        denoiseRTScratch = new THREE.WebGLRenderTarget(giW, giH, giRTParams);
        temporalRT_A = new THREE.WebGLRenderTarget(giW, giH, giRTParams);
        temporalRT_B = new THREE.WebGLRenderTarget(giW, giH, giRTParams);
        readTemporalRT = temporalRT_A; writeTemporalRT = temporalRT_B;

        const [ssrW, ssrH] = getScaledDimensions(params.sceneSsrScale);
        ssrSize.set(ssrW, ssrH);
        ssrRT = new THREE.WebGLRenderTarget(ssrW, ssrH, giRTParams);
        denoiseSsrRT = new THREE.WebGLRenderTarget(ssrW, ssrH, giRTParams);
        denoiseSsrRTScratch = new THREE.WebGLRenderTarget(ssrW, ssrH, giRTParams);
        temporalSsrRT_A = new THREE.WebGLRenderTarget(ssrW, ssrH, giRTParams);
        temporalSsrRT_B = new THREE.WebGLRenderTarget(ssrW, ssrH, giRTParams);
        readTemporalSsrRT = temporalSsrRT_A; writeTemporalSsrRT = temporalSsrRT_B;

        const [volumeW, volumeH] = getScaledDimensions(params.sceneVolumeScale);
        volumeSize.set(volumeW, volumeH);
        volumetricRT = new THREE.WebGLRenderTarget(volumeW, volumeH, giRTParams);
        denoiseVolumeRT = new THREE.WebGLRenderTarget(volumeW, volumeH, giRTParams);
        denoiseVolumeRTScratch = new THREE.WebGLRenderTarget(volumeW, volumeH, giRTParams);
        temporalVolumeRT_A = new THREE.WebGLRenderTarget(volumeW, volumeH, giRTParams);
        temporalVolumeRT_B = new THREE.WebGLRenderTarget(volumeW, volumeH, giRTParams);
        readTemporalVolumeRT = temporalVolumeRT_A; writeTemporalVolumeRT = temporalVolumeRT_B;
    }
    initRenderTargets();

    function resizeRenderTargets() {
        const w = window.innerWidth; const h = window.innerHeight;
        screenColorRT.setSize(w, h); screenNormalDistRT.setSize(w, h);
        prevScreenColorRT.setSize(w, h); prevScreenNormalDistRT.setSize(w, h);

        const [giW, giH] = getScaledDimensions(params.sceneGiScale);
        giSize.set(giW, giH);
        ssgiRT.setSize(giW, giH); denoiseRT.setSize(giW, giH); denoiseRTScratch.setSize(giW, giH);
        temporalRT_A.setSize(giW, giH); temporalRT_B.setSize(giW, giH);

        const [ssrW, ssrH] = getScaledDimensions(params.sceneSsrScale);
        ssrSize.set(ssrW, ssrH);
        ssrRT.setSize(ssrW, ssrH); denoiseSsrRT.setSize(ssrW, ssrH); denoiseSsrRTScratch.setSize(ssrW, ssrH);
        temporalSsrRT_A.setSize(ssrW, ssrH); temporalSsrRT_B.setSize(ssrW, ssrH);

        const [volumeW, volumeH] = getScaledDimensions(params.sceneVolumeScale);
        volumeSize.set(volumeW, volumeH);
        volumetricRT.setSize(volumeW, volumeH); denoiseVolumeRT.setSize(volumeW, volumeH); denoiseVolumeRTScratch.setSize(volumeW, volumeH);
        temporalVolumeRT_A.setSize(volumeW, volumeH); temporalVolumeRT_B.setSize(volumeW, volumeH);

        if(displayMat) {
            displayMat.uniforms.uGiSize.value.copy(giSize);
            displayMat.uniforms.uSsrSize.value.copy(ssrSize);
            displayMat.uniforms.uVolumeSize.value.copy(volumeSize);
        }
        temporalHistoryValid = false;
    }

    // --- SHADERS & MATERIALS ---
    const commonVert = `
        varying vec3 vNormal; varying vec3 vWorldPos; varying vec2 vUv;
        void main() {
            vUv = uv;
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPosition.xyz;
            vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `;
    
    const normalPerturbGLSL = `
        vec3 perturbNormal2Arb( vec3 eye_pos, vec3 surf_norm ) {
            vec3 q0 = dFdx( eye_pos.xyz );
            vec3 q1 = dFdy( eye_pos.xyz );
            vec2 st0 = dFdx( vUv.st );
            vec2 st1 = dFdy( vUv.st );
            float scale = sign( st1.t * st0.s - st0.t * st1.s );
            vec3 S = ( q0 * st1.t - q1 * st0.t ) * scale;
            vec3 T = ( - q0 * st1.s + q1 * st0.s ) * scale;
            vec3 N = normalize( surf_norm );
            
            // PREVENT NaN CASCADE: If UVs are degenerate, fallback to vertex normal
            if (length(S) < 0.0001 || length(T) < 0.0001) return N;
            
            mat3 tsn = mat3( normalize(S), normalize(T), N );
            vec3 mapN = texture2D( tNormalMap, vUv ).xyz * 2.0 - 1.0;
            return normalize( tsn * mapN );
        }
    `;
    
    const textureUniforms = `
        uniform vec3 uColor; uniform vec3 uEmissive;
        uniform float uRoughness; uniform float uMetallic;
        uniform sampler2D tDiffuse; uniform bool uHasDiffuse;
        uniform sampler2D tRoughnessMap; uniform bool uHasRoughness;
        uniform sampler2D tMetalnessMap; uniform bool uHasMetalnessMap;
        uniform sampler2D tNormalMap; uniform bool uHasNormal;
        uniform sampler2D tEmissiveMap; uniform bool uHasEmissiveMap;
    `;
    
    const screenColorFrag = `
        ${textureUniforms}
        varying vec2 vUv;
        void main() {
            vec3 color = uHasDiffuse ? texture2D(tDiffuse, vUv).rgb * uColor : uColor;
            float metal = uHasMetalnessMap ? texture2D(tMetalnessMap, vUv).b * uMetallic : uMetallic;
            float rough = uHasRoughness ? texture2D(tRoughnessMap, vUv).g * uRoughness : uRoughness;
            vec3 emColor = uHasEmissiveMap ? texture2D(tEmissiveMap, vUv).rgb * uEmissive : uEmissive;
            
            float p = metal * 100.0 + rough;
            if (length(emColor) > 0.01) p += 1000.0;
            
            gl_FragColor = vec4(length(emColor) > 0.01 ? emColor : color, p);
        }
    `;
    
    const screenNormalFrag = `
        ${textureUniforms}
        uniform vec3 uCameraPos;
        varying vec3 vNormal; varying vec3 vWorldPos; varying vec2 vUv;
        ${normalPerturbGLSL}
        void main() {
            // Prevent NaN if vNormal is completely zeroed out
            vec3 finalNormal = length(vNormal) > 0.0001 ? normalize(vNormal) : vec3(0.0, 1.0, 0.0);
            if(uHasNormal) finalNormal = perturbNormal2Arb(vWorldPos, finalNormal);
            gl_FragColor = vec4(finalNormal, length(vWorldPos - uCameraPos));
        }
    `;
    
    const stochasticColorFrag = `
        ${textureUniforms}
        uniform float uSeed;
        uniform int uSampleEpoch;
        uniform float uStableDensity; uniform float uOcclusionBias; uniform float uOcclusionMaxBoost;
        uniform float uImportanceRatio; uniform int uRays; uniform int uSteps; uniform int uBounces; uniform float uBounceStrength;
        uniform float uStepSize; uniform float uStepGrowth;
        uniform bool uEscapeEnv; uniform float uMaxBrightness;
        uniform vec3 uProbePos; uniform bool uProbeSSR; uniform int uProbeSSRRays;
        uniform bool uProbeHistoryValid; uniform float uProbeHistoryBlend; uniform float uProbeHistoryDepthThreshold; uniform float uProbeHistoryNormalThreshold; uniform float uProbeMotion;
        uniform float uBrightnessCompensation;
        uniform samplerCube tCubeColorRead; uniform samplerCube tCubeNormalDistRead;
        varying vec3 vNormal; varying vec3 vWorldPos; varying vec2 vUv;
        ${normalPerturbGLSL}

        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 53.539))) * 43758.5453); }
        vec2 ld2(float index, float seed) {
            return fract(vec2(0.7548776662, 0.5698402910) * (index + 1.0 + seed * 13.0) + vec2(seed, seed * 0.37));
        }
        vec3 getHemisphereSample(vec3 normal, float u, float v) {
            float r = sqrt(u); float z = sqrt(1.0 - u); float phi = 2.0 * 3.14159265 * v;
            vec3 p = vec3(r * cos(phi), r * sin(phi), z);
            vec3 up = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
            vec3 tangent = normalize(cross(up, normal)); vec3 bitangent = cross(normal, tangent);
            return tangent * p.x + bitangent * p.y + normal * p.z;
        }
        vec3 clampLuma(vec3 value, float maxLuma) {
            float luma = dot(value, vec3(0.299, 0.587, 0.114));
            if (luma > maxLuma) value *= maxLuma / max(luma, 0.0001);
            return value;
        }
        vec3 sampleProbeBounceChain(vec3 baseNormal, float seed, int bounceCount) {
            vec3 bounceAccum = vec3(0.0);
            vec3 bounceNormal = baseNormal;
            float throughput = max(uBounceStrength, 0.01);
            for(int b = 1; b < 8; b++) {
                if(b >= bounceCount) break;
                vec2 xi = ld2(float(b), seed + float(b) * 0.23);
                vec3 bounceDir = getHemisphereSample(bounceNormal, xi.x, xi.y);
                vec4 bounceND = textureCube(tCubeNormalDistRead, bounceDir);
                vec3 bounceLight = textureCube(tCubeColorRead, bounceDir).rgb;
                float bounceLuma = dot(bounceLight, vec3(0.299, 0.587, 0.114));
                if (bounceLuma > uMaxBrightness * 0.3) bounceLight *= (uMaxBrightness * 0.3) / max(bounceLuma, 0.0001);
                bounceAccum += bounceLight * throughput;
                bounceNormal = normalize(mix(bounceNormal, bounceND.xyz, 0.75));
                throughput *= max(uBounceStrength, 0.01);
            }
            float accumLuma = dot(bounceAccum, vec3(0.299, 0.587, 0.114));
            if (accumLuma > uMaxBrightness * 0.25) bounceAccum *= (uMaxBrightness * 0.25) / max(accumLuma, 0.0001);
            return bounceAccum;
        }

        void main() {
            vec3 seedPos = floor(vWorldPos * 100.0);
            float spatialHash = hash(seedPos);
            float stableHash = hash(seedPos + vec3(float(uSampleEpoch) * 0.73, float(uSampleEpoch) * 1.17, float(uSampleEpoch) * 1.91));
            if(stableHash > uStableDensity) discard;
            float densityCompensation = mix(1.0, 1.0 / max(uStableDensity, 0.05), 0.35);
            float occlusionCompensation = 1.0 + uOcclusionBias * 0.15;
            float sampleWeight = min(densityCompensation * occlusionCompensation, uOcclusionMaxBoost);

            vec3 emColor = uHasEmissiveMap ? texture2D(tEmissiveMap, vUv).rgb * uEmissive : uEmissive;
            if(length(emColor) > 0.01) { gl_FragColor = vec4(emColor * sampleWeight * uBrightnessCompensation, 1.0); return; }

            vec3 baseColor = uHasDiffuse ? texture2D(tDiffuse, vUv).rgb * uColor : uColor;
            float metal = uHasMetalnessMap ? texture2D(tMetalnessMap, vUv).b * uMetallic : uMetallic;
            float roughness = uHasRoughness ? texture2D(tRoughnessMap, vUv).g * uRoughness : uRoughness;
            vec3 finalNormal = length(vNormal) > 0.0001 ? normalize(vNormal) : vec3(0.0, 1.0, 0.0);
            if(uHasNormal) finalNormal = perturbNormal2Arb(vWorldPos, finalNormal);

            vec3 indirectLight = vec3(0.0);
            int numBaseRays = int(float(uRays) * (1.0 - uImportanceRatio));
            vec3 bestDir = finalNormal; float bestLuma = 0.0;
            float baseSeed = fract(spatialHash + stableHash * 3.0 + uSeed * 11.0);

            for(int i = 0; i < 64; i++) {
                if(i >= uRays) break;
                vec2 xi = ld2(float(i), baseSeed);
                vec3 rayDir;
                if (i < numBaseRays || bestLuma < 0.001) rayDir = getHemisphereSample(finalNormal, xi.x, xi.y);
                else {
                    vec3 randDir = getHemisphereSample(bestDir, fract(xi.x + 0.37), fract(xi.y + 0.61));
                    rayDir = normalize(mix(randDir, bestDir, 0.68));
                }

                float currentStepSize = uStepSize;
                float jitter = fract(baseSeed + float(i) * 0.834925225) * currentStepSize;
                vec3 marchPos = vWorldPos + finalNormal * 0.1 + rayDir * jitter;
                vec3 rayLight = vec3(0.0);
                bool hit = false;
                for(int j = 0; j < 64; j++) {
                    if(j >= uSteps) break;
                    marchPos += rayDir * currentStepSize; currentStepSize *= uStepGrowth;
                    vec3 toMarchPos = marchPos - uProbePos;
                    float currentDist = length(toMarchPos);
                    vec3 sampleDir = toMarchPos / max(currentDist, 0.0001);
                    vec4 cubeND = textureCube(tCubeNormalDistRead, sampleDir);
                    float hitDist = cubeND.a; float depthDiff = currentDist - hitDist;
                    if(hitDist > 0.001 && depthDiff > -0.2 && depthDiff < currentStepSize * 2.0) {
                        rayLight = clampLuma(textureCube(tCubeColorRead, sampleDir).rgb, uMaxBrightness * 0.35);
                        rayLight += sampleProbeBounceChain(normalize(cubeND.xyz), baseSeed + float(i * 13 + j * 7), uBounces);
                        rayLight = clampLuma(rayLight, uMaxBrightness * 0.4);
                        hit = true; break;
                    }
                }

                if (!hit && uEscapeEnv) rayLight = clampLuma(textureCube(tCubeColorRead, rayDir).rgb, uMaxBrightness * 0.35);
                float rayLuma = dot(rayLight, vec3(0.299, 0.587, 0.114));
                if (rayLuma > uMaxBrightness) rayLight *= uMaxBrightness / max(rayLuma, 0.0001);
                if (i < numBaseRays && rayLuma > bestLuma) { bestLuma = rayLuma; bestDir = rayDir; }
                indirectLight += rayLight;
            }
            indirectLight /= float(max(1, uRays));
            indirectLight = clampLuma(indirectLight, uMaxBrightness * 0.35);

            vec3 indirectSpec = vec3(0.0);
            vec3 viewDiff = uProbePos - vWorldPos;
            vec3 viewDir = length(viewDiff) > 0.0001 ? normalize(viewDiff) : vec3(0.0, 1.0, 0.0);
            vec3 reflectDir = reflect(-viewDir, finalNormal);
            if (uProbeSSR && roughness < 0.8 && uProbeSSRRays > 0) {
                for(int i = 0; i < 16; i++) {
                    if(i >= uProbeSSRRays) break;
                    vec2 xi = ld2(float(i), baseSeed + 0.41);
                    vec3 lobeDir = getHemisphereSample(reflectDir, xi.x, xi.y);
                    vec3 rayDir = normalize(mix(reflectDir, lobeDir, roughness));
                    if (dot(rayDir, finalNormal) < 0.0) rayDir = normalize(rayDir + finalNormal * 0.2);
                    indirectSpec += textureCube(tCubeColorRead, rayDir).rgb;
                }
                indirectSpec /= float(max(1, uProbeSSRRays));
                indirectSpec = clampLuma(indirectSpec, uMaxBrightness * 0.25);
            }

            vec3 f0 = mix(vec3(0.04), baseColor, metal);
            float NdotV = max(dot(finalNormal, viewDir), 0.0001);
            vec3 F = f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(1.0 - NdotV, 5.0);
            vec3 kd = (1.0 - F) * (1.0 - metal);
            vec3 shaded = (kd * baseColor * indirectLight + F * indirectSpec) * sampleWeight * uBrightnessCompensation;

            vec3 toSurface = vWorldPos - uProbePos;
            float probeDist = length(toSurface);
            vec3 probeDir = toSurface / max(probeDist, 0.0001);
            vec4 historyND = textureCube(tCubeNormalDistRead, probeDir);
            float depthThreshold = uProbeHistoryDepthThreshold + probeDist * 0.02;
            float historyDepthValid = 1.0 - step(depthThreshold, abs(historyND.a - probeDist));
            float historyNormalValid = step(uProbeHistoryNormalThreshold, max(dot(normalize(historyND.xyz), finalNormal), 0.0));
            float historyBlend = (uProbeHistoryValid ? 1.0 : 0.0) * uProbeHistoryBlend * historyDepthValid * historyNormalValid * clamp(1.0 - uProbeMotion * 4.0, 0.0, 1.0);
            vec3 historyColor = clampLuma(textureCube(tCubeColorRead, probeDir).rgb, uMaxBrightness * 0.3);
            shaded = clampLuma(shaded, uMaxBrightness * 0.32);
            vec3 minHistory = shaded / 1.1;
            vec3 maxHistory = shaded * 1.1 + vec3(0.02);
            historyColor = clamp(historyColor, minHistory, maxHistory);
            gl_FragColor = vec4(mix(shaded, historyColor, historyBlend), 1.0);
        }
    `;

    const stochasticNormalFrag = `
        ${textureUniforms}
        uniform float uSeed;
        uniform int uSampleEpoch;
        uniform float uStableDensity;
        uniform vec3 uProbePos;
        uniform bool uProbeHistoryValid; uniform float uProbeHistoryBlend; uniform float uProbeHistoryDepthThreshold; uniform float uProbeHistoryNormalThreshold; uniform float uProbeMotion;
        uniform samplerCube tCubeNormalDistRead;
        varying vec3 vNormal; varying vec3 vWorldPos; varying vec2 vUv;
        ${normalPerturbGLSL}
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 53.539))) * 43758.5453); }
        void main() {
            vec3 seedPos = floor(vWorldPos * 100.0);
            float stableHash = hash(seedPos + vec3(float(uSampleEpoch) * 0.73, float(uSampleEpoch) * 1.17, float(uSampleEpoch) * 1.91));
            if(stableHash > uStableDensity) discard;
            vec3 finalNormal = length(vNormal) > 0.0001 ? normalize(vNormal) : vec3(0.0, 1.0, 0.0);
            if(uHasNormal) finalNormal = perturbNormal2Arb(vWorldPos, finalNormal);
            float probeDist = length(vWorldPos - uProbePos);
            vec3 probeDir = (vWorldPos - uProbePos) / max(probeDist, 0.0001);
            vec4 historyND = textureCube(tCubeNormalDistRead, probeDir);
            float historyDepthValid = 1.0 - step(uProbeHistoryDepthThreshold + probeDist * 0.02, abs(historyND.a - probeDist));
            float historyNormalValid = step(uProbeHistoryNormalThreshold, max(dot(normalize(historyND.xyz), finalNormal), 0.0));
            float historyBlend = (uProbeHistoryValid ? 1.0 : 0.0) * uProbeHistoryBlend * historyDepthValid * historyNormalValid * clamp(1.0 - uProbeMotion * 4.0, 0.0, 1.0);
            vec3 outNormal = normalize(mix(finalNormal, historyND.xyz, historyBlend));
            float outDepth = mix(probeDist, historyND.a, historyBlend);
            gl_FragColor = vec4(outNormal, outDepth);
        }
    `;

    function buildShaderParams(p) {
        let colorObj = p.color !== undefined ? new THREE.Color(p.color) : new THREE.Color(0xffffff);
        let emissiveObj = p.emissive !== undefined ? new THREE.Color(p.emissive) : new THREE.Color(0x000000);
        emissiveObj.multiplyScalar(p.emissiveIntensity !== undefined ? p.emissiveIntensity : 1.0);
        
        const pbrMap = p.metalnessMap || p.roughnessMap || null;
    
        return {
            uColor: { value: colorObj },
            uEmissive: { value: emissiveObj },
            uRoughness: { value: p.roughness !== undefined ? p.roughness : 1.0 },
            uMetallic: { value: p.metalness !== undefined ? p.metalness : 0.0 },
            tDiffuse: { value: p.map || null },
            uHasDiffuse: { value: !!p.map },
            tRoughnessMap: { value: p.roughnessMap || null },
            uHasRoughness: { value: !!p.roughnessMap },
            tMetalnessMap: { value: pbrMap },
            uHasMetalnessMap: { value: !!pbrMap },
            tNormalMap: { value: p.normalMap || null },
            uHasNormal: { value: !!p.normalMap },
            tEmissiveMap: { value: p.emissiveMap || null },
            uHasEmissiveMap: { value: !!p.emissiveMap },
            uCameraPos: { value: camera.position }
        };
    }
    
    function createMaterials(p) {
        const baseU = buildShaderParams(p);
        const stocU = {
            ...buildShaderParams(p), uSeed: { value: 0 },
            uSampleEpoch: { value: sampleEpoch },
            uStableDensity: { value: params.probeStableDensity },
            uOcclusionBias: { value: params.occlusionBias },
            uOcclusionMaxBoost: { value: params.occlusionMaxBoost },
            uProbePos: { value: currentProbePos },
            uProbeSSR: { value: params.probeSSR },
            uProbeSSRRays: { value: params.probeSSRRays },
            uImportanceRatio: { value: params.cubeImportanceRatio },
            uRays: { value: params.cubeRays }, uSteps: { value: params.cubeSteps }, uBounces: { value: params.probeGIBounces }, uBounceStrength: { value: params.probeBounceStrength },
            uStepSize: { value: params.cubeStepSize }, uStepGrowth: { value: params.cubeStepGrowth },
            uEscapeEnv: { value: params.escapeGI }, uMaxBrightness: { value: params.maxRayBrightness },
            uProbeHistoryValid: { value: false },
            uProbeHistoryBlend: { value: params.probeHistoryBlend },
            uProbeHistoryDepthThreshold: { value: params.probeHistoryDepthThreshold },
            uProbeHistoryNormalThreshold: { value: params.probeHistoryNormalThreshold },
            uProbeMotion: { value: 0.0 },
            uBrightnessCompensation: { value: 1.0 },
            tCubeColorRead: { value: null }, tCubeNormalDistRead: { value: null }
        };
        
        return {
            screenColor: new THREE.ShaderMaterial({ vertexShader: commonVert, fragmentShader: screenColorFrag, uniforms: baseU, side: THREE.DoubleSide }),
            screenNormal: new THREE.ShaderMaterial({ vertexShader: commonVert, fragmentShader: screenNormalFrag, uniforms: baseU, side: THREE.DoubleSide, extensions: { derivatives: true } }),
            stocColor: new THREE.ShaderMaterial({ vertexShader: commonVert, fragmentShader: stochasticColorFrag, uniforms: stocU, side: THREE.DoubleSide, extensions: { derivatives: true } }),
            stocNormal: new THREE.ShaderMaterial({ vertexShader: commonVert, fragmentShader: stochasticNormalFrag, uniforms: stocU, side: THREE.DoubleSide, extensions: { derivatives: true } })
        };
    }
    
    function configureVolumeMesh(mesh, descriptor) {
        mesh.userData.isVolume = true;
        mesh.userData.volumeColor = descriptor.color.clone();
        mesh.userData.volumeDensity = descriptor.density;
        mesh.userData.volumeUsesDefaultDensity = descriptor.usesDefaultDensity === true;
        mesh.visible = false;
        volumeMeshes.push(mesh);
    }
    
    let sceneMeshes = []; let userModels = []; let cornellWalls = []; let skyMesh = null;
    
    function addMesh(geometry, mats, position, rotation, userData = {}) {
        const mesh = new THREE.Mesh(geometry, mats.screenColor);
        mesh.position.copy(position);
        if(rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);
        mesh.userData = { ...userData, mats };
        scene.add(mesh);
    
        if (mesh.userData.isVolume) {
            const defaultColor = mats && mats.screenColor ? mats.screenColor.uniforms.uColor.value : new THREE.Color(0xffffff);
            configureVolumeMesh(mesh, {
                color: toThreeColor(mesh.userData.volumeColor !== undefined ? mesh.userData.volumeColor : defaultColor, defaultColor),
                density: Math.max(0.0, mesh.userData.volumeDensity !== undefined ? mesh.userData.volumeDensity : params.defaultVolumeDensity),
                usesDefaultDensity: mesh.userData.volumeDensity === undefined
            });
        } else {
            sceneMeshes.push(mesh);
        }
        return mesh;
    }
    
    // --- PHYSICS SETUP ---
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    world.defaultContactMaterial.friction = 0.2;
    world.defaultContactMaterial.restitution = 0.8; // Bouncy
    
    const physFloor = new CANNON.Body({ mass: 0 });
    physFloor.addShape(new CANNON.Plane());
    physFloor.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
    physFloor.position.y = -5;
    world.addBody(physFloor);
    
    const physObjects = [];
    function addPhysWall(nx, ny, nz, px, py, pz) {
        const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Plane());
        const q = new CANNON.Quaternion(); q.setFromVectors(new CANNON.Vec3(0,0,1), new CANNON.Vec3(nx,ny,nz));
        b.quaternion.copy(q); b.position.set(px, py, pz);
        world.addBody(b); physObjects.push(b);
    }
    addPhysWall(0, -1, 0, 0, 5, 0); // Ceiling
    addPhysWall(1, 0, 0, -5, 0, 0); // Left
    addPhysWall(-1, 0, 0, 5, 0, 0); // Right
    addPhysWall(0, 0, 1, 0, 0, -5); // Back
    addPhysWall(0, 0, -1, 0, 0, 5); // Front
    
    function addPhysBox(w, h, d, px, py, pz, ry) {
        const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Box(new CANNON.Vec3(w/2, h/2, d/2)));
        b.position.set(px, py, pz); if(ry) b.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), ry);
        world.addBody(b); physObjects.push(b);
    }
    
    // --- SCENE CONSTRUCTION ---
    const wallGeo = new THREE.PlaneGeometry(10, 10);
    const boxWhiteMats = createMaterials({color: 0xcccccc, roughness: 0.9}); 
    const boxRedMats = createMaterials({color: 0xcc2222, roughness: 0.9});
    const boxGreenMats = createMaterials({color: 0x22cc22, roughness: 0.9});
    const boxBlueMats = createMaterials({color: 0x2255cc, roughness: 0.05, metalness: 0.0}); 
    const goldMats = createMaterials({color: 0xffcc33, roughness: 0.15, metalness: 1.0}); 
    
    cornellWalls.push(addMesh(wallGeo, boxRedMats, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(0, Math.PI/2, 0)));
    cornellWalls.push(addMesh(wallGeo, boxGreenMats, new THREE.Vector3(5, 0, 0), new THREE.Vector3(0, -Math.PI/2, 0)));
    cornellWalls.push(addMesh(wallGeo, boxWhiteMats, new THREE.Vector3(0, -5, 0), new THREE.Vector3(-Math.PI/2, 0, 0)));
    cornellWalls.push(addMesh(wallGeo, boxWhiteMats, new THREE.Vector3(0, 5, 0), new THREE.Vector3(Math.PI/2, 0, 0)));
    cornellWalls.push(addMesh(wallGeo, boxWhiteMats, new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 0)));
    cornellWalls.push(addMesh(wallGeo, boxWhiteMats, new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, Math.PI, 0)));
    
    addMesh(new THREE.BoxGeometry(3, 6, 3), boxWhiteMats, new THREE.Vector3(-1.5, -2, -1.5), new THREE.Vector3(0, 0.3, 0), { isDefault: true });
    addPhysBox(3, 6, 3, -1.5, -2, -1.5, 0.3);
    
    addMesh(new THREE.BoxGeometry(3, 3, 3), boxBlueMats, new THREE.Vector3(1.5, -3.5, 1.5), new THREE.Vector3(0, -0.3, 0), { isDefault: true });
    addPhysBox(3, 3, 3, 1.5, -3.5, 1.5, -0.3);
    
    addMesh(new THREE.SphereGeometry(1.5, 32, 32), goldMats, new THREE.Vector3(1.5, -0.5, 1.5), null, { isDefault: true });
    const bSph = new CANNON.Body({ mass: 0 }); bSph.addShape(new CANNON.Sphere(1.5));
    bSph.position.set(1.5, -0.5, 1.5); world.addBody(bSph); physObjects.push(bSph);
    
    const ceilingLightMats = createMaterials({color: 0x000000, emissive: 0xffffff, emissiveIntensity: 10.0}); 
    const movingLightMats = createMaterials({color: 0x000000, emissive: 0xff0000, emissiveIntensity: 10.0});
    
    const ceilingLightMesh = addMesh(new THREE.PlaneGeometry(3, 3), ceilingLightMats, new THREE.Vector3(0, 4.9, 0), new THREE.Vector3(Math.PI/2, 0, 0));
    const movingLightMesh = addMesh(new THREE.SphereGeometry(0.5, 16, 16), movingLightMats, new THREE.Vector3(0, 0, 0), null);
    
    // --- LOADERS (GLTF & HDRI) ---
    const gltfLoader = new THREE.GLTFLoader();
    let currentUserModelGroup = null;
    
    function updateModelScale() {
        if (!currentUserModelGroup) return;
        
        // Reset to calculate natural unscaled bounds
        currentUserModelGroup.position.set(0, 0, 0);
        currentUserModelGroup.scale.set(1, 1, 1);
        currentUserModelGroup.updateMatrixWorld(true);
        
        const box = new THREE.Box3().setFromObject(currentUserModelGroup); 
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
        
        // Apply base 7.0 unit normalization multiplied by user scale setting
        const scale = (7.0 / maxDim) * params.modelScale;
        currentUserModelGroup.scale.set(scale, scale, scale); 
        currentUserModelGroup.updateMatrixWorld(true);
        
        // Re-center and ground to floor (-5 Y)
        const box2 = new THREE.Box3().setFromObject(currentUserModelGroup); 
        const center2 = box2.getCenter(new THREE.Vector3());
        currentUserModelGroup.position.y = (-5 - box2.min.y); 
        currentUserModelGroup.position.x = -center2.x; 
        currentUserModelGroup.position.z = -center2.z;
        currentUserModelGroup.updateMatrixWorld(true);
    }
    
    function loadModel(url) {
        gltfLoader.load(url, (gltf) => {
            const model = gltf.scene;
    
            if (currentUserModelGroup) {
                scene.remove(currentUserModelGroup);
            }
            currentUserModelGroup = model;
    
            physObjects.forEach(b => world.removeBody(b));
            physObjects.length = 0;
    
            sceneMeshes = sceneMeshes.filter(m => {
                if(m.userData.isDefault || userModels.includes(m)) {
                    if (m.parent) m.parent.remove(m);
                    else scene.remove(m);
                    return false;
                }
                return true;
            });
            volumeMeshes = volumeMeshes.filter(m => !userModels.includes(m));
            userModels = [];
    
            model.traverse((child) => {
                if (child.isMesh) {
                    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
                    if (!child.geometry.attributes.uv) {
                        const uvs = new Float32Array(child.geometry.attributes.position.count * 2);
                        child.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
                    }
    
                    const matsArray = Array.isArray(child.material) ? child.material : [child.material];
                    const m = matsArray[0];
                    const volumeDescriptor = getVolumeDescriptor(child, m);
                    if (volumeDescriptor) {
                        configureVolumeMesh(child, volumeDescriptor);
                        userModels.push(child);
                        return;
                    }
    
                    const matParams = {
                        color: m.color, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
                        roughness: m.roughness !== undefined ? m.roughness : 0.5,
                        metalness: m.metalness !== undefined ? m.metalness : 0.0,
                        map: m.map, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap,
                        normalMap: m.normalMap, emissiveMap: m.emissiveMap
                    };
    
                    const customMats = createMaterials(matParams);
                    child.userData.mats = customMats; child.material = customMats.screenColor;
                    sceneMeshes.push(child); userModels.push(child);
                }
            });
            scene.add(model);
            updateModelScale();
            sampleEpoch = (sampleEpoch + 1) % 1048576;
            probeFrameCount = 0;
            volumeFrameCount = 0;
            previousProbePos.copy(currentProbePos);
            volumeProbeHistoryValid = true;
            probeHistoryValid = false;
            temporalHistoryValid = false;
        });
    }
    
    const rgbeLoader = new THREE.RGBELoader();
    rgbeLoader.setDataType(THREE.FloatType);
    
    function loadHDRI(url) {
        rgbeLoader.load(url, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearFilter;
            
            if (!skyMesh) {
                const skyGeo = new THREE.SphereGeometry(200, 64, 32);
                skyGeo.scale(-1, 1, 1);
                
                const skyMats = createMaterials({ 
                    color: 0x000000, 
                    emissive: 0xffffff, 
                    emissiveIntensity: params.skyBrightness,
                    emissiveMap: texture
                });
                skyMesh = addMesh(skyGeo, skyMats, new THREE.Vector3(0,0,0), null, { isSky: true });
            } else {
                skyMesh.userData.mats.screenColor.uniforms.tEmissiveMap.value = texture;
                skyMesh.userData.mats.screenColor.uniforms.uHasEmissiveMap.value = true;
                skyMesh.userData.mats.stocColor.uniforms.tEmissiveMap.value = texture;
                skyMesh.userData.mats.stocColor.uniforms.uHasEmissiveMap.value = true;
            }
            
            cornellWalls.forEach(w => w.visible = false);
            if(ceilingLightMesh) ceilingLightMesh.visible = false;
            params.ceilingLight = false;
            
            // Clear physics walls to match the open HDRI environment
            physObjects.forEach(b => world.removeBody(b));
            physObjects.length = 0;
            
            gui.controllersRecursive().forEach(c => c.updateDisplay());
            sampleEpoch = (sampleEpoch + 1) % 1048576;
            probeFrameCount = 0;
            volumeFrameCount = 0;
            previousProbePos.copy(currentProbePos);
            volumeProbeHistoryValid = true;
            probeHistoryValid = false;
            temporalHistoryValid = false;
        });
    }
    
    // --- POST-PROCESSING PASSES ---
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    
    const commonUtils = `
        float IGN(vec2 pixelPos) {
            vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
            return fract(magic.z * fract(dot(pixelPos, magic.xy)));
        }
        float hash13(vec3 p) {
            return fract(sin(dot(p, vec3(12.9898, 78.233, 53.539))) * 43758.5453);
        }
        vec3 getHemisphereSample(vec3 normal, float u, float v) {
            float r = sqrt(u); float z = sqrt(1.0 - u); float phi = 2.0 * 3.14159265 * v;
            vec3 p = vec3(r * cos(phi), r * sin(phi), z);
            vec3 up = abs(normal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
            vec3 tangent = normalize(cross(up, normal)); vec3 bitangent = cross(normal, tangent);
            return tangent * p.x + bitangent * p.y + normal * p.z;
        }
        vec3 getSphereSample(float u, float v) {
            float z = 1.0 - 2.0 * u;
            float r = sqrt(max(0.0, 1.0 - z * z));
            float phi = 2.0 * 3.14159265 * v;
            return vec3(r * cos(phi), z, r * sin(phi));
        }
    `;
    
    const volumetricUniformsGLSL = `
        uniform samplerCube tSolidCubeColor; uniform samplerCube tSolidCubeNormalDist; uniform samplerCube tVolumeCube;
        uniform vec3 uProbePos;
        uniform int uViewSamples; uniform int uLightRays; uniform int uRaySteps;
        uniform float uRayStepSize; uniform float uRayStepGrowth;
        uniform bool uEscapeEnv; uniform bool uUseVolumeHistory;
        uniform float uMaxBrightness;
        uniform int uVolumeCount;
        uniform mat4 uVolumeWorldToLocal[${MAX_VOLUMES}];
        uniform vec3 uVolumeBoundsMin[${MAX_VOLUMES}];
        uniform vec3 uVolumeBoundsMax[${MAX_VOLUMES}];
        uniform vec4 uVolumeColorDensity[${MAX_VOLUMES}];
        uniform vec3 uHeightFogColor;
        uniform float uHeightFogDensity; uniform float uHeightFogHeight; uniform float uHeightFogFalloff;
        uniform float uVolumetricExtinction; uniform float uVolumetricAlbedo; uniform float uVolumetricMaxDistance;
    `;
    
    const volumetricUtils = `
        ${volumetricUniformsGLSL}
        vec4 sampleMedium(vec3 worldPos) {
            vec3 accumColor = vec3(0.0);
            float accumDensity = 0.0;
    
            float fogDensity = uHeightFogDensity * exp((uHeightFogHeight - worldPos.y) * max(uHeightFogFalloff, 0.0001));
            fogDensity = clamp(fogDensity, 0.0, 4.0);
            accumColor += uHeightFogColor * fogDensity;
            accumDensity += fogDensity;
    
            for(int i = 0; i < ${MAX_VOLUMES}; i++) {
                if(i >= uVolumeCount) break;
                vec3 localPos = (uVolumeWorldToLocal[i] * vec4(worldPos, 1.0)).xyz;
                vec3 minBounds = uVolumeBoundsMin[i];
                vec3 maxBounds = uVolumeBoundsMax[i];
                bool inside = all(greaterThanEqual(localPos, minBounds)) && all(lessThanEqual(localPos, maxBounds));
                if(!inside) continue;
    
                vec3 center = 0.5 * (minBounds + maxBounds);
                vec3 halfSize = max((maxBounds - minBounds) * 0.5, vec3(0.0001));
                vec3 normalizedLocal = abs((localPos - center) / halfSize);
                float edgeFactor = 1.0 - smoothstep(0.82, 1.0, max(max(normalizedLocal.x, normalizedLocal.y), normalizedLocal.z));
                float density = uVolumeColorDensity[i].a * edgeFactor;
                accumColor += uVolumeColorDensity[i].rgb * density;
                accumDensity += density;
            }
    
            if(accumDensity < 0.0001) return vec4(0.0);
            return vec4(accumColor / accumDensity, accumDensity);
        }
    
        vec3 limitRadiance(vec3 value) {
            float luma = dot(value, vec3(0.299, 0.587, 0.114));
            if(luma > uMaxBrightness) value *= uMaxBrightness / max(luma, 0.0001);
            return value;
        }
    
        vec4 sampleProbeVolumeEvent(vec3 worldPos, float depthWindow) {
            vec3 toSample = worldPos - uProbePos;
            float probeDist = length(toSample);
            if(probeDist < 0.0001) return vec4(0.0);
    
            vec3 probeDir = toSample / probeDist;
            vec4 solidHit = textureCube(tSolidCubeNormalDist, probeDir);
            float solidDepth = solidHit.a;
            float surfaceWindow = max(depthWindow, 0.05);
            if(solidDepth > 0.001 && probeDist >= solidDepth - surfaceWindow) return vec4(0.0);
    
            vec4 probeEvent = textureCube(tVolumeCube, probeDir);
            if(probeEvent.a <= 0.001) return vec4(0.0);
    
            float eventWindow = max(depthWindow * 2.0, 0.1 + probeDist * 0.02);
            float depthDelta = abs(probeEvent.a - probeDist);
            if(depthDelta > eventWindow) return vec4(0.0);
    
            float weight = 1.0 - depthDelta / eventWindow;
            return vec4(probeEvent.rgb, weight);
        }
    
        vec3 traceVolumeRay(vec3 rayOrigin, vec3 rayDir, float seedOffset) {
            float currentStepSize = uRayStepSize;
            float travel = 0.0;
            vec3 marchPos = rayOrigin + rayDir * fract(seedOffset) * currentStepSize;
            vec3 radiance = vec3(0.0);
            float transmittance = 1.0;
            bool hit = false;
    
            for(int j = 0; j < 64; j++) {
                if(j >= uRaySteps || travel >= uVolumetricMaxDistance) break;
                marchPos += rayDir * currentStepSize;
                travel += currentStepSize;
    
                vec3 toMarchPos = marchPos - uProbePos;
                float currentDist = length(toMarchPos);
                vec3 sampleDir = toMarchPos / max(currentDist, 0.0001);
    
                vec4 cubeND = textureCube(tSolidCubeNormalDist, sampleDir);
                float surfaceWindow = max(0.08, currentStepSize * 1.5);
                if(cubeND.a > 0.001 && currentDist >= cubeND.a - surfaceWindow) {
                    radiance += transmittance * textureCube(tSolidCubeColor, sampleDir).rgb;
                    hit = true;
                    break;
                }
    
                vec4 medium = sampleMedium(marchPos);
                if(medium.a > 0.0001) {
                    float extinction = medium.a * uVolumetricExtinction;
                    float stepTransmittance = exp(-extinction * currentStepSize);
                    float scatterAmount = 1.0 - stepTransmittance;
                    vec3 localIncoming = vec3(0.0);
    
                    if(uUseVolumeHistory) {
                        vec4 probeScatter = sampleProbeVolumeEvent(marchPos, currentStepSize);
                        if(probeScatter.a > 0.0) localIncoming += probeScatter.rgb * probeScatter.a;
                    }
    
                    if(dot(localIncoming, localIncoming) > 0.0) {
                        radiance += transmittance * localIncoming * medium.rgb * uVolumetricAlbedo * scatterAmount;
                    }
    
                    transmittance *= stepTransmittance;
                    if(transmittance < 0.01) break;
                }
                currentStepSize *= uRayStepGrowth;
            }
    
            if(!hit && uEscapeEnv) radiance += transmittance * textureCube(tSolidCubeColor, rayDir).rgb;
            return limitRadiance(radiance);
        }
    
        vec3 integrateVolumetricSegment(vec3 rayOrigin, vec3 rayDir, float maxDist, float baseSeed) {
            float clampedMaxDist = min(maxDist, uVolumetricMaxDistance);
            if(clampedMaxDist <= 0.01) return vec3(0.0);
    
            float segmentLength = clampedMaxDist / float(max(1, uViewSamples));
            vec3 accumulated = vec3(0.0);
            float viewTransmittance = 1.0;
    
            for(int i = 0; i < ${MAX_VOLUME_VIEW_SAMPLES}; i++) {
                if(i >= uViewSamples) break;
                float jitter = fract(baseSeed + float(i) * 0.38196601125);
                float sampleDist = min((float(i) + jitter) * segmentLength, clampedMaxDist);
                vec3 samplePos = rayOrigin + rayDir * sampleDist;
                vec4 medium = sampleMedium(samplePos);
                if(medium.a < 0.0001) continue;
    
                vec3 incoming = vec3(0.0);
                for(int r = 0; r < ${MAX_VOLUME_LIGHT_RAYS}; r++) {
                    if(r >= uLightRays) break;
                    float u1 = fract(baseSeed + float(i) * 0.173 + float(r) * 0.6180339887);
                    float u2 = fract(baseSeed + float(i) * 0.697 + float(r) * 0.7548776662);
                    incoming += traceVolumeRay(samplePos, getSphereSample(u1, u2), baseSeed + float(i * 17 + r * 31));
                }
                incoming /= float(max(1, uLightRays));
                if(uUseVolumeHistory) {
                    vec4 probeScatter = sampleProbeVolumeEvent(samplePos, segmentLength);
                    if(probeScatter.a > 0.0) incoming += probeScatter.rgb * probeScatter.a;
                }
    
                float extinction = medium.a * uVolumetricExtinction;
                float stepTransmittance = exp(-extinction * segmentLength);
                float scatterAmount = 1.0 - stepTransmittance;
                accumulated += viewTransmittance * incoming * medium.rgb * uVolumetricAlbedo * scatterAmount;
                viewTransmittance *= stepTransmittance;
                if(viewTransmittance < 0.01) break;
            }
    
            return limitRadiance(accumulated);
        }
    
        vec4 sampleVolumeEvent(vec3 rayOrigin, vec3 rayDir, float maxDist, float baseSeed) {
            float clampedMaxDist = min(maxDist, uVolumetricMaxDistance);
            if(clampedMaxDist <= 0.01) return vec4(0.0);
    
            float strataCount = float(max(1, uViewSamples));
            float strataIndex = floor(fract(baseSeed) * strataCount);
            float jitter = fract(baseSeed * 19.193 + 0.173);
            float sampleDist = ((strataIndex + jitter) / strataCount) * clampedMaxDist;
            sampleDist = min(sampleDist, max(clampedMaxDist - 0.01, 0.0));
            if(sampleDist <= 0.001) sampleDist = min(clampedMaxDist * 0.5, clampedMaxDist);
    
            vec3 samplePos = rayOrigin + rayDir * sampleDist;
            vec4 medium = sampleMedium(samplePos);
            if(medium.a < 0.0001) return vec4(0.0);
    
            vec3 incoming = vec3(0.0);
            for(int r = 0; r < ${MAX_VOLUME_LIGHT_RAYS}; r++) {
                if(r >= uLightRays) break;
                float u1 = fract(baseSeed + float(r) * 0.6180339887 + 0.13);
                float u2 = fract(baseSeed + float(r) * 0.7548776662 + 0.57);
                incoming += traceVolumeRay(samplePos, getSphereSample(u1, u2), baseSeed + float(r * 31 + 11));
            }
            incoming /= float(max(1, uLightRays));
            return vec4(limitRadiance(incoming), sampleDist);
        }
    `;
    
    const ssgiMat = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: screenColorRT.texture }, tNormalDist: { value: screenNormalDistRT.texture },
            tCubeColor: { value: null }, tCubeNormalDist: { value: null },
            uCameraPos: { value: camera.position }, uProbePos: { value: currentProbePos },
            uInvProj: { value: camera.projectionMatrixInverse }, uInvView: { value: camera.matrixWorld },
            uSeed: { value: 0 }, uRays: { value: params.rays }, uSteps: { value: params.steps }, uBounces: { value: params.sceneGIBounces }, uBounceStrength: { value: params.sceneBounceStrength },
            uStepSize: { value: params.stepSize }, uStepGrowth: { value: params.stepGrowth }, uImportanceRatio: { value: params.importanceRatio },
            uEscapeEnv: { value: params.escapeGI }, uMaxBrightness: { value: params.maxRayBrightness }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tColor; uniform sampler2D tNormalDist; uniform samplerCube tCubeColor; uniform samplerCube tCubeNormalDist;
            uniform vec3 uCameraPos; uniform vec3 uProbePos; uniform mat4 uInvProj; uniform mat4 uInvView;
            uniform float uSeed; uniform int uRays; uniform int uSteps; uniform int uBounces; uniform float uBounceStrength; uniform float uStepSize; uniform float uStepGrowth; uniform float uImportanceRatio;
            uniform bool uEscapeEnv; uniform float uMaxBrightness;
            varying vec2 vUv;
            ${commonUtils}
            vec2 ld2(float index, float seed) {
                return fract(vec2(0.7548776662, 0.5698402910) * (index + 1.0 + seed * 13.0) + vec2(seed, seed * 0.37));
            }
            vec3 clampLuma(vec3 value, float maxLuma) {
                float luma = dot(value, vec3(0.299, 0.587, 0.114));
                if (luma > maxLuma) value *= maxLuma / max(luma, 0.0001);
                return value;
            }
            vec3 sampleBounceChain(vec3 baseNormal, float seed, int bounceCount) {
                vec3 bounceAccum = vec3(0.0);
                vec3 bounceNormal = baseNormal;
                float throughput = max(uBounceStrength, 0.01);
                for(int b = 1; b < 8; b++) {
                    if(b >= bounceCount) break;
                    vec2 xi = ld2(float(b), seed + float(b) * 0.19);
                    vec3 bounceDir = getHemisphereSample(bounceNormal, xi.x, xi.y);
                    vec4 bounceND = textureCube(tCubeNormalDist, bounceDir);
                    vec3 bounceLight = textureCube(tCubeColor, bounceDir).rgb;
                    float bounceLuma = dot(bounceLight, vec3(0.299, 0.587, 0.114));
                    if (bounceLuma > uMaxBrightness * 0.3) bounceLight *= (uMaxBrightness * 0.3) / max(bounceLuma, 0.0001);
                    bounceAccum += bounceLight * throughput;
                    bounceNormal = normalize(mix(bounceNormal, bounceND.xyz, 0.75));
                    throughput *= max(uBounceStrength, 0.01);
                }
                float accumLuma = dot(bounceAccum, vec3(0.299, 0.587, 0.114));
                if (accumLuma > uMaxBrightness * 0.25) bounceAccum *= (uMaxBrightness * 0.25) / max(accumLuma, 0.0001);
                return bounceAccum;
            }
            void main() {
                vec4 baseColorData = texture2D(tColor, vUv);
                vec4 normalDist = texture2D(tNormalDist, vUv);
                float dist = normalDist.a;
                float p = baseColorData.a;
                bool isEmissive = p >= 1000.0;
                if(dist < 0.1 || isEmissive) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

                vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                vec4 viewRay = uInvProj * ndc;
                vec3 rayDirToPixel = normalize((uInvView * vec4(viewRay.xyz, 0.0)).xyz);
                vec3 worldPos = uCameraPos + rayDirToPixel * dist;
                vec3 normal = normalize(normalDist.xyz);
                vec3 probeGuide = textureCube(tCubeNormalDist, normalize(worldPos - uProbePos)).xyz;

                vec3 indirectLight = vec3(0.0);
                int numBaseRays = int(float(uRays) * (1.0 - uImportanceRatio));
                vec3 bestDir = normalize(mix(normal, probeGuide, 0.35));
                float bestLuma = 0.0;
                float pixelSeed = IGN(gl_FragCoord.xy + vec2(uSeed * 1000.0, uSeed * 731.0));

                for(int i = 0; i < 64; i++) {
                    if(i >= uRays) break;
                    vec2 xi = ld2(float(i), pixelSeed);
                    vec3 rayDir;
                    if (i < numBaseRays || bestLuma < 0.001) rayDir = getHemisphereSample(normal, xi.x, xi.y);
                    else {
                        vec3 randDir = getHemisphereSample(bestDir, fract(xi.x + 0.41), fract(xi.y + 0.67));
                        rayDir = normalize(mix(randDir, bestDir, 0.68));
                    }

                    float currentStepSize = uStepSize;
                    vec3 marchPos = worldPos + normal * 0.05 + rayDir * fract(pixelSeed + float(i) * 0.834925225) * currentStepSize;
                    vec3 rayLight = vec3(0.0);
                    bool hit = false;
                    for(int j = 0; j < 64; j++) {
                        if(j >= uSteps) break;
                        marchPos += rayDir * currentStepSize; currentStepSize *= uStepGrowth;
                        vec3 toMarchPos = marchPos - uProbePos; float currentDist = length(toMarchPos);
                        vec3 sampleDir = toMarchPos / max(currentDist, 0.0001);
                        vec4 cubeND = textureCube(tCubeNormalDist, sampleDir);
                        if(cubeND.a > 0.001 && (currentDist - cubeND.a) > -0.2 && (currentDist - cubeND.a) < currentStepSize * 2.0) {
                            rayLight = clampLuma(textureCube(tCubeColor, sampleDir).rgb, uMaxBrightness * 0.35);
                            rayLight += sampleBounceChain(normalize(cubeND.xyz), pixelSeed + float(i * 11 + j * 5), uBounces);
                            rayLight = clampLuma(rayLight, uMaxBrightness * 0.4);
                            hit = true; break;
                        }
                    }
                    if (!hit && uEscapeEnv) rayLight = clampLuma(textureCube(tCubeColor, rayDir).rgb, uMaxBrightness * 0.35);
                    float rayLuma = dot(rayLight, vec3(0.299, 0.587, 0.114));
                    if (rayLuma > uMaxBrightness) rayLight *= uMaxBrightness / max(rayLuma, 0.0001);
                    if (i < numBaseRays && rayLuma > bestLuma) { bestLuma = rayLuma; bestDir = rayDir; }
                    indirectLight += rayLight;
                }
                indirectLight = clampLuma(indirectLight / float(max(1, uRays)), uMaxBrightness * 0.35);
                gl_FragColor = vec4(indirectLight, 1.0);
            }
        `
    });
    const ssgiQuad = new THREE.Mesh(quadGeo, ssgiMat);

    const ssrMat = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: screenColorRT.texture }, tNormalDist: { value: screenNormalDistRT.texture },
            tCubeColor: { value: null }, tCubeNormalDist: { value: null },
            uCameraPos: { value: camera.position }, uProbePos: { value: currentProbePos },
            uInvProj: { value: camera.projectionMatrixInverse }, uInvView: { value: camera.matrixWorld },
            uSeed: { value: 0 }, uRays: { value: params.ssrRays }, uSteps: { value: params.ssrSteps },
            uStepSize: { value: params.stepSize }, uStepGrowth: { value: params.stepGrowth },
            uEscapeEnv: { value: params.escapeSSR }, uMaxBrightness: { value: params.maxRayBrightness }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tColor; uniform sampler2D tNormalDist; uniform samplerCube tCubeColor; uniform samplerCube tCubeNormalDist;
            uniform vec3 uCameraPos; uniform vec3 uProbePos; uniform mat4 uInvProj; uniform mat4 uInvView;
            uniform float uSeed; uniform int uRays; uniform int uSteps; uniform float uStepSize; uniform float uStepGrowth;
            uniform bool uEscapeEnv; uniform float uMaxBrightness;
            varying vec2 vUv;
            ${commonUtils}
            vec2 ld2(float index, float seed) {
                return fract(vec2(0.7548776662, 0.5698402910) * (index + 1.0 + seed * 13.0) + vec2(seed, seed * 0.37));
            }
            void main() {
                vec4 baseColorData = texture2D(tColor, vUv);
                vec4 normalDist = texture2D(tNormalDist, vUv);
                float dist = normalDist.a;
                float p = baseColorData.a;
                bool isEmissive = p >= 1000.0;
                if (isEmissive) p -= 1000.0;
                float roughness = fract(p);
                if(dist < 0.1 || isEmissive || roughness >= 0.8) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

                vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                vec4 viewRay = uInvProj * ndc;
                vec3 rayDirToPixel = normalize((uInvView * vec4(viewRay.xyz, 0.0)).xyz);
                vec3 worldPos = uCameraPos + rayDirToPixel * dist;
                vec3 normal = normalize(normalDist.xyz);
                vec3 reflectDir = reflect(rayDirToPixel, normal);
                vec3 indirectSpec = vec3(0.0);
                float pixelSeed = IGN(gl_FragCoord.xy + vec2(uSeed * 997.0, uSeed * 577.0));

                for(int i = 0; i < 64; i++) {
                    if(i >= uRays) break;
                    vec2 xi = ld2(float(i), pixelSeed);
                    vec3 lobeDir = getHemisphereSample(reflectDir, xi.x, xi.y);
                    vec3 rayDir = normalize(mix(reflectDir, lobeDir, roughness));
                    if (dot(rayDir, normal) < 0.0) rayDir = normalize(rayDir + normal * 0.2);

                    float currentStepSize = uStepSize;
                    vec3 marchPos = worldPos + normal * 0.05 + rayDir * fract(pixelSeed + float(i) * 0.834925225) * currentStepSize;
                    vec3 rayLight = vec3(0.0);
                    bool hit = false;
                    for(int j = 0; j < 64; j++) {
                        if(j >= uSteps) break;
                        marchPos += rayDir * currentStepSize; currentStepSize *= uStepGrowth;
                        vec3 toMarchPos = marchPos - uProbePos; float currentDist = length(toMarchPos);
                        vec3 sampleDir = toMarchPos / max(currentDist, 0.0001);
                        vec4 cubeND = textureCube(tCubeNormalDist, sampleDir);
                        if(cubeND.a > 0.001 && (currentDist - cubeND.a) > -0.2 && (currentDist - cubeND.a) < currentStepSize * 2.0) {
                            rayLight = textureCube(tCubeColor, sampleDir).rgb;
                            hit = true; break;
                        }
                    }
                    if (!hit && uEscapeEnv) rayLight = textureCube(tCubeColor, rayDir).rgb;
                    float rayLuma = dot(rayLight, vec3(0.299, 0.587, 0.114));
                    if (rayLuma > uMaxBrightness) rayLight *= uMaxBrightness / max(rayLuma, 0.0001);
                    indirectSpec += rayLight;
                }
                gl_FragColor = vec4(indirectSpec / float(max(1, uRays)), 1.0);
            }
        `
    });
    const ssrQuad = new THREE.Mesh(quadGeo, ssrMat);

    const denoiseMat = new THREE.ShaderMaterial({
        uniforms: {
            tRawGI: { value: null }, tNormalDist: { value: screenNormalDistRT.texture }, tColor: { value: screenColorRT.texture },
            uTexelSize: { value: new THREE.Vector2(1 / window.innerWidth, 1 / window.innerHeight) },
            uRadius: { value: 2 }, uDepthWeight: { value: 20.0 }, uNormWeight: { value: 4.0 }, uRoughWeight: { value: 0.0 }, uLumaClamp: { value: 1.25 }, uJitter: { value: params.upsampleJitter }, uStrength: { value: 1.0 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tRawGI; uniform sampler2D tNormalDist; uniform sampler2D tColor; uniform vec2 uTexelSize;
            uniform int uRadius; uniform float uDepthWeight; uniform float uNormWeight; uniform float uRoughWeight; uniform float uLumaClamp; uniform float uJitter; uniform float uStrength;
            varying vec2 vUv;
            void main() {
                float hash1 = fract(sin(dot(vUv + vec2(uJitter * 0.17, uJitter * 0.31), vec2(12.9898, 78.233))) * 43758.5453);
                float hash2 = fract(hash1 * 1.6180339887 + uJitter * 0.37);
                vec2 centerUv = clamp(vUv + (vec2(hash1, hash2) - 0.5) * uTexelSize * uJitter, vec2(0.0), vec2(1.0));
                vec4 centerND = texture2D(tNormalDist, centerUv);
                vec4 centerColor = texture2D(tColor, centerUv);
                vec4 centerRawData = texture2D(tRawGI, centerUv);
                if(centerND.w < 0.1 || uRadius == 0) { gl_FragColor = centerRawData; return; }
                float centerRough = fract(centerColor.a);
                vec3 centerRaw = centerRawData.rgb;
                vec3 sumColor = centerRaw;
                float sumWeight = 1.0;
                float radius = max(float(uRadius), 1.0);
                for(int x = -8; x <= 8; x++) {
                    if(x < -uRadius || x > uRadius) continue;
                    for(int y = -8; y <= 8; y++) {
                        if(y < -uRadius || y > uRadius || (x == 0 && y == 0)) continue;
                        vec2 sampleUv = clamp(centerUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0));
                        vec4 sampleND = texture2D(tNormalDist, sampleUv);
                        if(sampleND.w < 0.1) continue;
                        vec4 sampleColorData = texture2D(tColor, sampleUv);
                        float spatialSq = float(x * x + y * y);
                        float spatialWeight = exp(-spatialSq / max(radius * radius * 0.65, 0.0001));
                        float depthDelta = centerND.w - sampleND.w;
                        float depthWeight = exp(-(depthDelta * depthDelta) * uDepthWeight);
                        float normalWeight = pow(max(0.0, dot(normalize(centerND.xyz), normalize(sampleND.xyz))), 1.0 + uNormWeight * 2.0);
                        float roughWeight = exp(-abs(fract(sampleColorData.a) - centerRough) * uRoughWeight);
                        float w = spatialWeight * depthWeight * max(normalWeight, 0.0001) * roughWeight;
                        vec3 sampleColor = texture2D(tRawGI, sampleUv).rgb;
                        vec3 minClamp = centerRaw / max(uLumaClamp, 1.0);
                        vec3 maxClamp = centerRaw * uLumaClamp + vec3(0.05);
                        sampleColor = clamp(sampleColor, minClamp, maxClamp);
                        sumColor += sampleColor * w;
                        sumWeight += w;
                    }
                }
                vec3 filteredColor = sumColor / max(sumWeight, 0.0001);
                gl_FragColor = vec4(mix(centerRaw, filteredColor, clamp(uStrength, 0.0, 1.0)), centerRawData.a);
            }
        `
    });
    const denoiseQuad = new THREE.Mesh(quadGeo, denoiseMat);

    const prevViewProj = new THREE.Matrix4();
    const temporalMat = new THREE.ShaderMaterial({
        uniforms: {
            tCurrentGI: { value: null }, tHistoryGI: { value: null }, tNormalDist: { value: screenNormalDistRT.texture }, tPrevNormalDist: { value: prevScreenNormalDistRT.texture },
            tColor: { value: screenColorRT.texture }, tPrevColor: { value: prevScreenColorRT.texture },
            uCameraPos: { value: camera.position }, uPrevCameraPos: { value: previousCameraPos },
            uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() }, uPrevViewProj: { value: prevViewProj },
            uTexelSize: { value: new THREE.Vector2(1 / Math.max(giSize.x, 1), 1 / Math.max(giSize.y, 1)) },
            uBlend: { value: params.giTemporalBlend }, uBlendLowLight: { value: params.giTemporalBlendLow },
            uDepthThreshold: { value: params.giTemporalDepthThreshold }, uNormalThreshold: { value: params.giTemporalNormalThreshold },
            uNeighborhoodClamp: { value: params.giTemporalNeighborhoodClamp }, uMaterialThreshold: { value: 0.2 }, uEnabled: { value: true }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tCurrentGI; uniform sampler2D tHistoryGI; uniform sampler2D tNormalDist; uniform sampler2D tPrevNormalDist;
            uniform sampler2D tColor; uniform sampler2D tPrevColor;
            uniform vec3 uCameraPos; uniform vec3 uPrevCameraPos; uniform mat4 uInvProj; uniform mat4 uInvView; uniform mat4 uPrevViewProj;
            uniform vec2 uTexelSize;
            uniform float uBlend; uniform float uBlendLowLight; uniform float uDepthThreshold; uniform float uNormalThreshold; uniform float uNeighborhoodClamp; uniform float uMaterialThreshold; uniform bool uEnabled;
            varying vec2 vUv;
            void main() {
                vec3 currentGI = texture2D(tCurrentGI, vUv).rgb;
                vec4 currentND = texture2D(tNormalDist, vUv);
                vec4 currentColor = texture2D(tColor, vUv);
                float dist = currentND.w;
                if(!uEnabled || dist < 0.1) { gl_FragColor = vec4(currentGI, 1.0); return; }

                vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                vec3 worldPos = uCameraPos + normalize((uInvView * vec4((uInvProj * ndc).xyz, 0.0)).xyz) * dist;
                vec4 prevClip = uPrevViewProj * vec4(worldPos, 1.0);
                if(prevClip.w <= 0.0001) { gl_FragColor = vec4(currentGI, 1.0); return; }
                vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
                if(prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) { gl_FragColor = vec4(currentGI, 1.0); return; }

                vec4 prevND = texture2D(tPrevNormalDist, prevUv);
                vec4 prevColor = texture2D(tPrevColor, prevUv);
                float expectedPrevDist = length(worldPos - uPrevCameraPos);
                float depthTolerance = uDepthThreshold + expectedPrevDist * 0.02;
                float depthValid = prevND.w > 0.1 ? 1.0 - step(depthTolerance, abs(prevND.w - expectedPrevDist)) : 0.0;
                float normalValid = step(uNormalThreshold, max(dot(normalize(prevND.xyz), normalize(currentND.xyz)), 0.0));
                float materialValid = 1.0 - step(uMaterialThreshold, abs(prevColor.a - currentColor.a));
                float historyValid = depthValid * normalValid * materialValid;
                if(historyValid < 0.5) { gl_FragColor = vec4(currentGI, 1.0); return; }

                vec3 neighborhoodMin = currentGI;
                vec3 neighborhoodMax = currentGI;
                for(int x = -1; x <= 1; x++) {
                    for(int y = -1; y <= 1; y++) {
                        vec2 sampleUv = clamp(vUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0));
                        vec3 sampleColor = texture2D(tCurrentGI, sampleUv).rgb;
                        neighborhoodMin = min(neighborhoodMin, sampleColor);
                        neighborhoodMax = max(neighborhoodMax, sampleColor);
                    }
                }

                vec3 historyGI = texture2D(tHistoryGI, prevUv).rgb;
                vec3 rangeCenter = 0.5 * (neighborhoodMin + neighborhoodMax);
                vec3 halfRange = (neighborhoodMax - neighborhoodMin) * 0.5 * max(uNeighborhoodClamp, 1.0) + vec3(0.02);
                historyGI = clamp(historyGI, rangeCenter - halfRange, rangeCenter + halfRange);
                float luma = dot(currentGI, vec3(0.299, 0.587, 0.114));
                float historyWeight = clamp(mix(uBlendLowLight, uBlend, clamp(luma * 3.0, 0.0, 1.0)), 0.0, 0.98) * historyValid;
                gl_FragColor = vec4(mix(currentGI, historyGI, historyWeight), 1.0);
            }
        `
    });
    const temporalQuad = new THREE.Mesh(quadGeo, temporalMat);

    const volumetricMat = new THREE.ShaderMaterial({
        uniforms: {
            tNormalDist: { value: screenNormalDistRT.texture },
            tSolidCubeColor: { value: null }, tSolidCubeNormalDist: { value: null }, tVolumeCube: { value: null },
            uCameraPos: { value: camera.position }, uProbePos: { value: currentProbePos },
            uInvProj: { value: camera.projectionMatrixInverse }, uInvView: { value: camera.matrixWorld },
            uSeed: { value: 0 },
            uViewSamples: { value: params.volumetricViewSamples }, uLightRays: { value: params.volumetricLightRays },
            uRaySteps: { value: params.volumetricSteps }, uRayStepSize: { value: params.volumetricStepSize }, uRayStepGrowth: { value: params.volumetricStepGrowth },
            uEscapeEnv: { value: params.escapeGI }, uUseVolumeHistory: { value: true }, uMaxBrightness: { value: params.maxRayBrightness },
            ...sharedVolumeUniforms
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tNormalDist;
            uniform vec3 uCameraPos; uniform mat4 uInvProj; uniform mat4 uInvView;
            uniform float uSeed;
            varying vec2 vUv;
            ${commonUtils}
            ${volumetricUtils}
            void main() {
                float sceneDist = texture2D(tNormalDist, vUv).a;
                float maxDist = sceneDist > 0.1 ? min(sceneDist, uVolumetricMaxDistance) : uVolumetricMaxDistance;
                if(maxDist <= 0.01) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    
                vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                vec4 viewRay = uInvProj * ndc;
                vec3 rayDir = normalize(viewRay.xyz);
                //normalize((uInvView * vec4(viewRay.xyz, 0.0)).xyz);
                float baseSeed = IGN(gl_FragCoord.xy + mod(uSeed * 1000.0, 100.0));
                vec3 volumeLight = integrateVolumetricSegment(uCameraPos, rayDir, maxDist, baseSeed);
                gl_FragColor = vec4(volumeLight, maxDist);
            }
        `
    });
    const volumetricQuad = new THREE.Mesh(quadGeo, volumetricMat);
    
    const volumeCubeVert = `
        varying vec3 vWorldPos;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `;
    
    const volumeCubeMat = new THREE.ShaderMaterial({
        uniforms: {
            tSolidCubeColor: { value: null }, tSolidCubeNormalDist: { value: null }, tVolumeCube: { value: null },
            uProbePos: { value: currentProbePos }, uSeed: { value: 0 },
            uViewSamples: { value: params.volumetricCubeSamples }, uLightRays: { value: params.volumetricCubeLightRays },
            uRaySteps: { value: params.volumetricSteps }, uRayStepSize: { value: params.volumetricStepSize }, uRayStepGrowth: { value: params.volumetricStepGrowth },
            uEscapeEnv: { value: params.escapeGI }, uUseVolumeHistory: { value: false }, uMaxBrightness: { value: params.maxRayBrightness },
            ...sharedVolumeUniforms
        },
        vertexShader: volumeCubeVert,
        fragmentShader: `
            uniform float uSeed;
            varying vec3 vWorldPos;
            ${commonUtils}
            ${volumetricUtils}
            void main() {
                vec3 rayDir = normalize(vWorldPos - uProbePos);
                vec4 solidHit = textureCube(tSolidCubeNormalDist, rayDir);
                float maxDist = solidHit.a > 0.1 ? min(solidHit.a, uVolumetricMaxDistance) : uVolumetricMaxDistance;
                float baseSeed = hash13(rayDir * 53.0 + vec3(uSeed));
                vec4 probeEvent = sampleVolumeEvent(uProbePos, rayDir, maxDist, baseSeed);
                gl_FragColor = probeEvent;
            }
        `,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false
    });
    const volumeCubeShell = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), volumeCubeMat);
    volumeCubeShell.frustumCulled = false;
    const volumeCubeScene = new THREE.Scene();
    volumeCubeScene.add(volumeCubeShell);
    
    const displayMat = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: screenColorRT.texture }, tNormalDist: { value: screenNormalDistRT.texture },
            tGI: { value: null }, tSSR: { value: null }, tVolume: { value: null }, tRawVolume: { value: null }, tDebugCube: { value: null },
            uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
            uShowRawGI: { value: false }, uShowRawVolume: { value: false }, uShowCubemap: { value: false }, uAspect: { value: window.innerWidth / window.innerHeight },
            uEnableGI: { value: true }, uEnableSSR: { value: true }, uEnableVolumetrics: { value: true }, uVolumetricIntensity: { value: params.volumetricIntensity },
            uJitterStrength: { value: params.upsampleJitter }, uGiSize: { value: giSize.clone() }, uSsrSize: { value: ssrSize.clone() }, uVolumeSize: { value: volumeSize.clone() }, uSeed: { value: 0 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tColor; uniform sampler2D tNormalDist; uniform sampler2D tGI; uniform sampler2D tSSR; uniform sampler2D tVolume; uniform sampler2D tRawVolume; uniform samplerCube tDebugCube;
            uniform mat4 uInvProj; uniform mat4 uInvView;
            uniform bool uShowRawGI; uniform bool uShowRawVolume; uniform bool uShowCubemap; uniform float uAspect;
            uniform bool uEnableGI; uniform bool uEnableSSR; uniform bool uEnableVolumetrics; uniform float uVolumetricIntensity;
            uniform float uJitterStrength; uniform vec2 uGiSize; uniform vec2 uSsrSize; uniform vec2 uVolumeSize; uniform float uSeed;
            varying vec2 vUv;

            vec3 ACESFilm(vec3 x) { return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
            ${commonUtils}

            void main() {
                vec4 baseData = texture2D(tColor, vUv);
                vec3 albedo = baseData.rgb;
                float p = baseData.a;
                bool isEmissive = p >= 1000.0;
                if (isEmissive) p -= 1000.0;
                float metallic = clamp(floor(p) / 100.0, 0.0, 1.0);
                float roughness = fract(p);

                vec2 giUv = vUv;
                vec2 ssrUv = vUv;
                vec2 volumeUv = vUv;

                if(uShowRawGI) { gl_FragColor = vec4(ACESFilm(texture2D(tGI, giUv).rgb), 1.0); return; }
                if(uShowRawVolume) { gl_FragColor = vec4(ACESFilm(texture2D(tRawVolume, volumeUv).rgb), 1.0); return; }

                vec3 volumeRadiance = uEnableVolumetrics ? texture2D(tVolume, volumeUv).rgb * uVolumetricIntensity : vec3(0.0);
                if (isEmissive) { gl_FragColor = vec4(ACESFilm(albedo + volumeRadiance), 1.0); return; }

                vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                vec3 viewDir = normalize((uInvView * vec4((uInvProj * ndc).xyz, 0.0)).xyz);
                vec3 V = normalize(-viewDir);
                vec3 N = normalize(texture2D(tNormalDist, vUv).xyz);
                float NdotV = max(dot(N, V), 0.0001);

                vec3 giRadiance = uEnableGI ? texture2D(tGI, giUv).rgb : vec3(0.0);
                vec3 ssrRadiance = uEnableSSR ? texture2D(tSSR, ssrUv).rgb : vec3(0.0);
                vec3 f0 = mix(vec3(0.04), albedo, metallic);
                vec3 F = f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(1.0 - NdotV, 5.0);
                vec3 kd = (1.0 - F) * (1.0 - metallic);
                vec3 diffuseLight = kd * albedo * giRadiance;
                vec3 specularLight = ssrRadiance * F;
                vec3 finalColor = diffuseLight + specularLight + volumeRadiance;

                if(uShowCubemap) {
                    float boxWidth = 0.3; float boxHeight = boxWidth * uAspect;
                    if(vUv.x > 1.0 - boxWidth && vUv.y < boxHeight) {
                        vec2 localUv = vec2((vUv.x - (1.0 - boxWidth)) / boxWidth, vUv.y / boxHeight);
                        float phi = (localUv.x - 0.5) * 2.0 * 3.14159265; float theta = (1.0 - localUv.y) * 3.14159265;
                        vec3 dir = vec3(sin(theta) * sin(phi), cos(theta), sin(theta) * cos(phi));
                        finalColor = textureCube(tDebugCube, dir).rgb;
                    }
                }

                finalColor = ACESFilm(finalColor);
                gl_FragColor = vec4(pow(finalColor, vec3(1.0 / 2.2)), 1.0);
            }
        `
    });
    const displayQuad = new THREE.Mesh(quadGeo, displayMat);

    const copyMat = new THREE.ShaderMaterial({
        uniforms: { tInput: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tInput; varying vec2 vUv; void main() { gl_FragColor = texture2D(tInput, vUv); }`
    });
    const copyQuad = new THREE.Mesh(quadGeo, copyMat);

    const postScene = new THREE.Scene();
    
    // --- CONTROLS & PHYSICS SPAWNING ---
    const blocker = document.getElementById('blocker');
    let controlsLocked = false; let pitch = 0, yaw = 0; 
    const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    
    const spawnSphereGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const dynamicBodies = [];
    
    function spawnPhysicsSphere() {
        const isGlowing = Math.random() > 0.5;
        const colorHex = Math.floor(Math.random() * 0xffffff);
        let mats;
        if(isGlowing) {
            mats = createMaterials({color: 0x000000, emissive: colorHex, emissiveIntensity: 20.0});
        } else {
            mats = createMaterials({color: colorHex, roughness: 0.05, metalness: 1.0});
        }
        
        // Starting position just in front of camera
        const startPos = new THREE.Vector3().copy(camera.position);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        startPos.addScaledVector(dir, 1.0);
        
        const mesh = addMesh(spawnSphereGeo, mats, startPos, null, { dynamic: true });
        
        const shape = new CANNON.Sphere(0.5);
        const body = new CANNON.Body({ mass: 1, shape: shape });
        body.position.copy(startPos);
        body.velocity.set(dir.x * 15, dir.y * 15, dir.z * 15);
        
        world.addBody(body);
        dynamicBodies.push({ mesh, body });
    }
    
    blocker.addEventListener('click', () => { document.body.requestPointerLock()?.catch(e=>{}); });
    document.addEventListener('pointerlockchange', () => {
        controlsLocked = document.pointerLockElement === document.body;
        blocker.style.display = controlsLocked ? 'none' : 'flex';
    });
    document.addEventListener('mousemove', (e) => {
        if (!controlsLocked) return;
        yaw -= e.movementX * 0.002; pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
        camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    });
    document.addEventListener('keydown', (e) => { 
        const k = e.key.toLowerCase();
        if(keys.hasOwnProperty(k)) keys[k] = true; 
        if(k === 'f' && controlsLocked) spawnPhysicsSphere();
    });
    document.addEventListener('keyup', (e) => { 
        const k = e.key.toLowerCase();
        if(keys.hasOwnProperty(k)) keys[k] = false; 
    });
    
    const direction = new THREE.Vector3();
    function updateControls(delta) {
        if (!controlsLocked) return; const speed = 5.0 * delta; direction.set(0,0,0);
        if (keys.w) direction.z -= 1; if (keys.s) direction.z += 1;
        if (keys.a) direction.x -= 1; if (keys.d) direction.x += 1;
        direction.normalize(); direction.applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(direction, speed);
        
        if (keys.e) camera.position.y += speed;
        if (keys.q) camera.position.y -= speed;
    }
    
    // --- RENDER LOOP ---
    camera.updateMatrixWorld(); prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    resizeRenderTargets(); 
    
    let lastTime = performance.now(); let frames = 0; let lastFpsTime = lastTime;
    
    function applyMaterialMode(mode) { sceneMeshes.forEach(m => { if (m.visible) m.material = m.userData.mats[mode]; }); }
    function blitTexture(texture, target) {
        copyMat.uniforms.tInput.value = texture;
        postScene.clear(); postScene.add(copyQuad); renderer.setRenderTarget(target); renderer.render(postScene, orthoCamera);
    }

    function runDenoisePasses(sourceTexture, targetA, targetB, size, settings) {
        const passCount = Math.max(0, settings.passes | 0);
        if (passCount === 0 || settings.radius <= 0 || settings.strength <= 0.0) return sourceTexture;

        let inputTexture = sourceTexture;
        let outputTarget = targetA;
        for (let pass = 0; pass < passCount; pass++) {
            denoiseMat.uniforms.uTexelSize.value.set(1.0 / Math.max(size.x, 1), 1.0 / Math.max(size.y, 1));
            denoiseMat.uniforms.uRadius.value = Math.min(8, settings.radius + pass);
            denoiseMat.uniforms.uDepthWeight.value = settings.depthWeight;
            denoiseMat.uniforms.uNormWeight.value = settings.normWeight;
            denoiseMat.uniforms.uRoughWeight.value = settings.roughWeight;
            denoiseMat.uniforms.uLumaClamp.value = settings.lumaClamp;
            denoiseMat.uniforms.uJitter.value = settings.jitter;
            denoiseMat.uniforms.uStrength.value = settings.strength;
            denoiseMat.uniforms.tColor.value = settings.colorTexture;
            denoiseMat.uniforms.tRawGI.value = inputTexture;
            postScene.clear(); postScene.add(denoiseQuad); renderer.setRenderTarget(outputTarget); renderer.render(postScene, orthoCamera);
            inputTexture = outputTarget.texture;
            outputTarget = outputTarget === targetA ? targetB : targetA;
        }

        return inputTexture;
    }

    function animate() {
        requestAnimationFrame(animate);
        timingProfiler.beginFrame();
        const now = performance.now(); const delta = (now - lastTime) / 1000; lastTime = now;

        updateControls(delta);
        const dt = Math.min(delta, 0.1);
        world.step(1 / 60, dt, 3);
        for(let i = 0; i < dynamicBodies.length; i++) {
            dynamicBodies[i].mesh.position.copy(dynamicBodies[i].body.position);
            dynamicBodies[i].mesh.quaternion.copy(dynamicBodies[i].body.quaternion);
        }

        targetProbePos.copy(camera.position);
        if (params.probePushOff > 0) {
            const dirs = [
                new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0),
                new THREE.Vector3(0,1,0), new THREE.Vector3(0,-1,0),
                new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1)
            ];
            probeRaycaster.far = params.probePushOff;
            let pushVec = new THREE.Vector3(0,0,0);
            for(let d of dirs) {
                probeRaycaster.set(camera.position, d);
                const hits = probeRaycaster.intersectObjects(sceneMeshes, false);
                if(hits.length > 0) {
                    const overlap = params.probePushOff - hits[0].distance;
                    pushVec.addScaledVector(d, -overlap);
                }
            }
            if (pushVec.length() > params.probePushOff) pushVec.normalize().multiplyScalar(params.probePushOff);
            targetProbePos.add(pushVec);
        }
        const probeSnapSize = Math.max(0.0, params.probeSnapSize);
        if (probeSnapSize > 0.0) snapVectorToGrid(targetProbePos, probeSnapSize, snappedProbePos);
        else snappedProbePos.copy(targetProbePos);
        currentProbePos.copy(snappedProbePos);
        probeMotionAmount = currentProbePos.distanceTo(previousProbePos);
        const probeHistoryThreshold = Math.max(0.02, params.cubeStepSize * 0.35);
        const volumeProbeHistoryThreshold = Math.max(0.02, params.volumetricStepSize * 0.35);
        probeHistoryValid = temporalHistoryValid && probeFrameCount > 0 && probeMotionAmount <= probeHistoryThreshold;
        volumeProbeHistoryValid = true;
        if (params.brightnessCompensationStrength > 0.0 && probeHistoryValid) {
            const compensationDelta = THREE.MathUtils.clamp((params.probeHistoryBlend - 0.5) * params.brightnessCompensationStrength, -params.brightnessCompensationClamp, params.brightnessCompensationClamp);
            brightnessCompensation = 1.0 + compensationDelta;
        } else {
            brightnessCompensation = 1.0;
        }

        if(movingLightMesh) {
            if(params.movingLight) {
                const time = now * 0.001;
                movingLightMesh.position.set(Math.sin(time) * 3.5, 2.0, Math.cos(time) * 3.5);
                const rgb = params.movingLightColor; const emM = new THREE.Color(rgb[0], rgb[1], rgb[2]).multiplyScalar(params.movingLightBrightness);
                movingLightMesh.userData.mats.screenColor.uniforms.uEmissive.value.copy(emM);
                movingLightMesh.userData.mats.stocColor.uniforms.uEmissive.value.copy(emM);
            } else {
                movingLightMesh.userData.mats.screenColor.uniforms.uEmissive.value.setHex(0x000000);
                movingLightMesh.userData.mats.stocColor.uniforms.uEmissive.value.setHex(0x000000);
                movingLightMesh.position.y = 1000;
            }
        }

        updateVolumeUniformState();
        renderer.setClearColor(0x000000, 0);
        applyMaterialMode('screenColor');
        renderer.setRenderTarget(screenColorRT); renderer.clear(); renderer.render(scene, camera);
        applyMaterialMode('screenNormal');
        renderer.setRenderTarget(screenNormalDistRT); renderer.clear(); renderer.render(scene, camera);

        const seed = nextFrameSeed();
        writeCubeCamColor.position.copy(currentProbePos); writeCubeCamNormalDist.position.copy(currentProbePos);
        sceneMeshes.forEach(m => {
            m.userData.mats.stocColor.uniforms.uSeed.value = seed;
            m.userData.mats.stocColor.uniforms.uSampleEpoch.value = sampleEpoch;
            m.userData.mats.stocColor.uniforms.uStableDensity.value = params.probeStableDensity;
            m.userData.mats.stocColor.uniforms.uOcclusionBias.value = params.occlusionBias;
            m.userData.mats.stocColor.uniforms.uOcclusionMaxBoost.value = params.occlusionMaxBoost;
            m.userData.mats.stocColor.uniforms.uProbePos.value.copy(currentProbePos);
            m.userData.mats.stocColor.uniforms.uProbeSSR.value = params.probeSSR;
            m.userData.mats.stocColor.uniforms.uProbeSSRRays.value = params.probeSSRRays;
            m.userData.mats.stocColor.uniforms.uImportanceRatio.value = params.cubeImportanceRatio;
            m.userData.mats.stocColor.uniforms.uRays.value = params.cubeRays;
            m.userData.mats.stocColor.uniforms.uSteps.value = params.cubeSteps;
            m.userData.mats.stocColor.uniforms.uBounces.value = params.probeGIBounces;
            m.userData.mats.stocColor.uniforms.uBounceStrength.value = params.probeBounceStrength;
            m.userData.mats.stocColor.uniforms.uStepSize.value = params.cubeStepSize;
            m.userData.mats.stocColor.uniforms.uStepGrowth.value = params.cubeStepGrowth;
            m.userData.mats.stocColor.uniforms.uEscapeEnv.value = params.escapeGI;
            m.userData.mats.stocColor.uniforms.uMaxBrightness.value = params.maxRayBrightness;
            m.userData.mats.stocColor.uniforms.uProbeHistoryValid.value = probeHistoryValid;
            m.userData.mats.stocColor.uniforms.uProbeHistoryBlend.value = params.probeHistoryBlend;
            m.userData.mats.stocColor.uniforms.uProbeHistoryDepthThreshold.value = params.probeHistoryDepthThreshold;
            m.userData.mats.stocColor.uniforms.uProbeHistoryNormalThreshold.value = params.probeHistoryNormalThreshold;
            m.userData.mats.stocColor.uniforms.uProbeMotion.value = probeMotionAmount;
            m.userData.mats.stocColor.uniforms.uBrightnessCompensation.value = brightnessCompensation;
            m.userData.mats.stocColor.uniforms.tCubeColorRead.value = readCubeColorRT.texture;
            m.userData.mats.stocColor.uniforms.tCubeNormalDistRead.value = readCubeNormalDistRT.texture;

            m.userData.mats.stocNormal.uniforms.uSeed.value = seed;
            m.userData.mats.stocNormal.uniforms.uSampleEpoch.value = sampleEpoch;
            m.userData.mats.stocNormal.uniforms.uStableDensity.value = params.probeStableDensity;
            m.userData.mats.stocNormal.uniforms.uProbePos.value.copy(currentProbePos);
            m.userData.mats.stocNormal.uniforms.uProbeHistoryValid.value = probeHistoryValid;
            m.userData.mats.stocNormal.uniforms.uProbeHistoryBlend.value = params.probeHistoryBlend;
            m.userData.mats.stocNormal.uniforms.uProbeHistoryDepthThreshold.value = params.probeHistoryDepthThreshold;
            m.userData.mats.stocNormal.uniforms.uProbeHistoryNormalThreshold.value = params.probeHistoryNormalThreshold;
            m.userData.mats.stocNormal.uniforms.uProbeMotion.value = probeMotionAmount;
            m.userData.mats.stocNormal.uniforms.tCubeNormalDistRead.value = readCubeNormalDistRT.texture;
        });

        timingProfiler.begin('Probe GI Trace');
        applyMaterialMode('stocColor'); writeCubeCamColor.update(renderer, scene);
        timingProfiler.end('Probe GI Trace');
        timingProfiler.begin('Probe GI Capture');
        applyMaterialMode('stocNormal'); writeCubeCamNormalDist.update(renderer, scene);
        timingProfiler.end('Probe GI Capture');

        if (params.enableVolumetrics) {
            timingProfiler.begin('Probe Volume Trace');
            volumeCubeShell.position.copy(currentProbePos);
            writeVolumeCubeCam.position.copy(currentProbePos);
            volumeCubeMat.uniforms.uProbePos.value.copy(currentProbePos);
            volumeCubeMat.uniforms.uSeed.value = seed;
            volumeCubeMat.uniforms.uViewSamples.value = params.volumetricCubeSamples;
            volumeCubeMat.uniforms.uLightRays.value = params.volumetricCubeLightRays;
            volumeCubeMat.uniforms.uRaySteps.value = params.volumetricSteps;
            volumeCubeMat.uniforms.uRayStepSize.value = params.volumetricStepSize;
            volumeCubeMat.uniforms.uRayStepGrowth.value = params.volumetricStepGrowth;
            volumeCubeMat.uniforms.uEscapeEnv.value = params.escapeGI;
            volumeCubeMat.uniforms.uUseVolumeHistory.value = volumeProbeHistoryValid;
            volumeCubeMat.uniforms.uMaxBrightness.value = params.maxRayBrightness;
            volumeCubeMat.uniforms.tSolidCubeColor.value = writeCubeColorRT.texture;
            volumeCubeMat.uniforms.tSolidCubeNormalDist.value = writeCubeNormalDistRT.texture;
            volumeCubeMat.uniforms.tVolumeCube.value = readVolumeCubeRT.texture;
            writeVolumeCubeCam.update(renderer, volumeCubeScene);
            timingProfiler.end('Probe Volume Trace');
        }

        if (params.enableGI) {
            timingProfiler.begin('Scene GI Gather');
            ssgiMat.uniforms.uSeed.value = seed; ssgiMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
            ssgiMat.uniforms.uInvView.value.copy(camera.matrixWorld); ssgiMat.uniforms.tCubeColor.value = writeCubeColorRT.texture;
            ssgiMat.uniforms.tCubeNormalDist.value = writeCubeNormalDistRT.texture; ssgiMat.uniforms.uRays.value = params.rays;
            ssgiMat.uniforms.uProbePos.value.copy(currentProbePos); ssgiMat.uniforms.uBounces.value = params.sceneGIBounces; ssgiMat.uniforms.uBounceStrength.value = params.sceneBounceStrength;
            ssgiMat.uniforms.uSteps.value = params.steps; ssgiMat.uniforms.uStepSize.value = params.stepSize;
            ssgiMat.uniforms.uStepGrowth.value = params.stepGrowth; ssgiMat.uniforms.uImportanceRatio.value = params.importanceRatio;
            ssgiMat.uniforms.uEscapeEnv.value = params.escapeGI; ssgiMat.uniforms.uMaxBrightness.value = params.maxRayBrightness;
            postScene.clear(); postScene.add(ssgiQuad); renderer.setRenderTarget(ssgiRT); renderer.render(postScene, orthoCamera);
            timingProfiler.end('Scene GI Gather');
        } else { renderer.setRenderTarget(ssgiRT); renderer.clear(); }

        if (params.enableSSR) {
            timingProfiler.begin('Scene SSR Gather');
            ssrMat.uniforms.uSeed.value = seed; ssrMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
            ssrMat.uniforms.uInvView.value.copy(camera.matrixWorld); ssrMat.uniforms.tCubeColor.value = writeCubeColorRT.texture;
            ssrMat.uniforms.tCubeNormalDist.value = writeCubeNormalDistRT.texture; ssrMat.uniforms.uRays.value = params.ssrRays;
            ssrMat.uniforms.uProbePos.value.copy(currentProbePos);
            ssrMat.uniforms.uSteps.value = params.ssrSteps; ssrMat.uniforms.uStepSize.value = params.stepSize;
            ssrMat.uniforms.uStepGrowth.value = params.stepGrowth;
            ssrMat.uniforms.uEscapeEnv.value = params.escapeSSR; ssrMat.uniforms.uMaxBrightness.value = params.maxRayBrightness;
            postScene.clear(); postScene.add(ssrQuad); renderer.setRenderTarget(ssrRT); renderer.render(postScene, orthoCamera);
            timingProfiler.end('Scene SSR Gather');
        } else { renderer.setRenderTarget(ssrRT); renderer.clear(); }

        if (params.enableVolumetrics) {
            timingProfiler.begin('Scene Volume Trace');
            volumetricMat.uniforms.uSeed.value = seed;
            volumetricMat.uniforms.uCameraPos.value.copy(camera.position);
            volumetricMat.uniforms.uProbePos.value.copy(currentProbePos);
            volumetricMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
            volumetricMat.uniforms.uInvView.value.copy(camera.matrixWorld);
            volumetricMat.uniforms.uViewSamples.value = params.volumetricViewSamples;
            volumetricMat.uniforms.uLightRays.value = params.volumetricLightRays;
            volumetricMat.uniforms.uRaySteps.value = params.volumetricSteps;
            volumetricMat.uniforms.uRayStepSize.value = params.volumetricStepSize;
            volumetricMat.uniforms.uRayStepGrowth.value = params.volumetricStepGrowth;
            volumetricMat.uniforms.uEscapeEnv.value = params.escapeGI;
            volumetricMat.uniforms.uUseVolumeHistory.value = volumeProbeHistoryValid;
            volumetricMat.uniforms.uMaxBrightness.value = params.maxRayBrightness;
            volumetricMat.uniforms.tSolidCubeColor.value = writeCubeColorRT.texture;
            volumetricMat.uniforms.tSolidCubeNormalDist.value = writeCubeNormalDistRT.texture;
            volumetricMat.uniforms.tVolumeCube.value = writeVolumeCubeRT.texture;
            postScene.clear(); postScene.add(volumetricQuad); renderer.setRenderTarget(volumetricRT); renderer.render(postScene, orthoCamera);
            timingProfiler.end('Scene Volume Trace');
        } else {
            renderer.setRenderTarget(volumetricRT); renderer.clear();
            renderer.setRenderTarget(denoiseVolumeRT); renderer.clear();
            renderer.setRenderTarget(writeTemporalVolumeRT); renderer.clear();
        }

        timingProfiler.begin('Denoise/TAA Composite');
        let giFilteredTexture = ssgiRT.texture;
        let ssrFilteredTexture = ssrRT.texture;
        let volumeFilteredTexture = volumetricRT.texture;

        if (params.enableGI) {
            giFilteredTexture = runDenoisePasses(ssgiRT.texture, denoiseRT, denoiseRTScratch, giSize, {
                radius: params.giDenoiseRadius,
                passes: params.giDenoisePasses,
                strength: params.giDenoiseStrength,
                depthWeight: params.giDenoiseDepthWeight,
                normWeight: params.giDenoiseNormWeight,
                roughWeight: 0.0,
                lumaClamp: params.giDenoiseLumaClamp,
                jitter: params.upsampleJitter,
                colorTexture: screenColorRT.texture
            });
        }
        if (params.enableSSR) {
            ssrFilteredTexture = runDenoisePasses(ssrRT.texture, denoiseSsrRT, denoiseSsrRTScratch, ssrSize, {
                radius: params.ssrDenoiseRadius,
                passes: params.ssrDenoisePasses,
                strength: params.ssrDenoiseStrength,
                depthWeight: params.ssrDenoiseDepthWeight,
                normWeight: params.ssrDenoiseNormWeight,
                roughWeight: params.ssrDenoiseRoughWeight,
                lumaClamp: params.ssrDenoiseLumaClamp,
                jitter: params.upsampleJitter,
                colorTexture: screenColorRT.texture
            });
        }
        if (params.enableVolumetrics) {
            volumeFilteredTexture = runDenoisePasses(volumetricRT.texture, denoiseVolumeRT, denoiseVolumeRTScratch, volumeSize, {
                radius: params.volumeDenoiseRadius,
                passes: params.volumeDenoisePasses,
                strength: params.volumeDenoiseStrength,
                depthWeight: params.volumeDenoiseDepthWeight,
                normWeight: params.volumeDenoiseNormWeight,
                roughWeight: 0.0,
                lumaClamp: params.volumeDenoiseLumaClamp,
                jitter: params.upsampleJitter,
                colorTexture: screenColorRT.texture
            });
        }

        temporalMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse); temporalMat.uniforms.uInvView.value.copy(camera.matrixWorld);
        temporalMat.uniforms.uCameraPos.value.copy(camera.position);
        temporalMat.uniforms.uPrevCameraPos.value.copy(previousCameraPos);
        temporalMat.uniforms.tPrevNormalDist.value = prevScreenNormalDistRT.texture;
        temporalMat.uniforms.tColor.value = screenColorRT.texture;
        temporalMat.uniforms.tPrevColor.value = prevScreenColorRT.texture;

        if (params.enableGI) {
            temporalMat.uniforms.uTexelSize.value.set(1.0 / giSize.x, 1.0 / giSize.y);
            temporalMat.uniforms.uEnabled.value = params.giTemporalEnabled && temporalHistoryValid;
            temporalMat.uniforms.uBlend.value = params.giTemporalBlend;
            temporalMat.uniforms.uBlendLowLight.value = params.giTemporalBlendLow;
            temporalMat.uniforms.uDepthThreshold.value = params.giTemporalDepthThreshold;
            temporalMat.uniforms.uNormalThreshold.value = params.giTemporalNormalThreshold;
            temporalMat.uniforms.uNeighborhoodClamp.value = params.giTemporalNeighborhoodClamp;
            temporalMat.uniforms.uMaterialThreshold.value = 0.2;
            temporalMat.uniforms.tCurrentGI.value = giFilteredTexture; temporalMat.uniforms.tHistoryGI.value = readTemporalRT.texture;
            postScene.clear(); postScene.add(temporalQuad); renderer.setRenderTarget(writeTemporalRT); renderer.render(postScene, orthoCamera);
        }
        if (params.enableSSR) {
            temporalMat.uniforms.uTexelSize.value.set(1.0 / ssrSize.x, 1.0 / ssrSize.y);
            temporalMat.uniforms.uEnabled.value = params.ssrTemporalEnabled && temporalHistoryValid;
            temporalMat.uniforms.uBlend.value = params.ssrTemporalBlend;
            temporalMat.uniforms.uBlendLowLight.value = params.ssrTemporalBlendLow;
            temporalMat.uniforms.uDepthThreshold.value = params.ssrTemporalDepthThreshold;
            temporalMat.uniforms.uNormalThreshold.value = params.ssrTemporalNormalThreshold;
            temporalMat.uniforms.uNeighborhoodClamp.value = params.ssrTemporalNeighborhoodClamp;
            temporalMat.uniforms.uMaterialThreshold.value = params.ssrTemporalRoughnessThreshold;
            temporalMat.uniforms.tCurrentGI.value = ssrFilteredTexture; temporalMat.uniforms.tHistoryGI.value = readTemporalSsrRT.texture;
            postScene.clear(); postScene.add(temporalQuad); renderer.setRenderTarget(writeTemporalSsrRT); renderer.render(postScene, orthoCamera);
        }
        if (params.enableVolumetrics) {
            temporalMat.uniforms.uTexelSize.value.set(1.0 / volumeSize.x, 1.0 / volumeSize.y);
            temporalMat.uniforms.uEnabled.value = params.volumeTemporalEnabled && temporalHistoryValid && volumeProbeHistoryValid;
            temporalMat.uniforms.uBlend.value = params.volumeTemporalBlend;
            temporalMat.uniforms.uBlendLowLight.value = params.volumeTemporalBlendLow;
            temporalMat.uniforms.uDepthThreshold.value = params.volumeTemporalDepthThreshold;
            temporalMat.uniforms.uNormalThreshold.value = params.volumeTemporalNormalThreshold;
            temporalMat.uniforms.uNeighborhoodClamp.value = params.volumeTemporalNeighborhoodClamp;
            temporalMat.uniforms.uMaterialThreshold.value = 10000.0;
            temporalMat.uniforms.tCurrentGI.value = volumeFilteredTexture; temporalMat.uniforms.tHistoryGI.value = readTemporalVolumeRT.texture;
            postScene.clear(); postScene.add(temporalQuad); renderer.setRenderTarget(writeTemporalVolumeRT); renderer.render(postScene, orthoCamera);
        }

        displayMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
        displayMat.uniforms.uInvView.value.copy(camera.matrixWorld);
        displayMat.uniforms.tColor.value = screenColorRT.texture; displayMat.uniforms.tGI.value = writeTemporalRT.texture;
        displayMat.uniforms.tSSR.value = writeTemporalSsrRT.texture; displayMat.uniforms.tVolume.value = writeTemporalVolumeRT.texture;
        displayMat.uniforms.tRawVolume.value = volumetricRT.texture;
        displayMat.uniforms.tDebugCube.value = writeCubeColorRT.texture;
        displayMat.uniforms.uShowRawGI.value = params.showRawGI; displayMat.uniforms.uShowRawVolume.value = params.showRawVolume; displayMat.uniforms.uShowCubemap.value = params.showCubemap;
        displayMat.uniforms.uEnableGI.value = params.enableGI; displayMat.uniforms.uEnableSSR.value = params.enableSSR; displayMat.uniforms.uEnableVolumetrics.value = params.enableVolumetrics;
        displayMat.uniforms.uVolumetricIntensity.value = params.volumetricIntensity;
        displayMat.uniforms.uJitterStrength.value = params.upsampleJitter; displayMat.uniforms.uSeed.value = seed;
        displayMat.uniforms.uGiSize.value.copy(giSize); displayMat.uniforms.uSsrSize.value.copy(ssrSize); displayMat.uniforms.uVolumeSize.value.copy(volumeSize);
        postScene.clear(); postScene.add(displayQuad); renderer.setRenderTarget(null); renderer.render(postScene, orthoCamera);

        blitTexture(screenColorRT.texture, prevScreenColorRT);
        blitTexture(screenNormalDistRT.texture, prevScreenNormalDistRT);
        timingProfiler.end('Denoise/TAA Composite');

        camera.updateMatrixWorld(); prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        if (writeCubeColorRT === cubeColorRT_B) {
            readCubeColorRT = cubeColorRT_B; readCubeNormalDistRT = cubeNormalDistRT_B;
            writeCubeColorRT = cubeColorRT_A; writeCubeNormalDistRT = cubeNormalDistRT_A;
            writeCubeCamColor = cubeCamColor_A; writeCubeCamNormalDist = cubeCamNormalDist_A;
        } else {
            readCubeColorRT = cubeColorRT_A; readCubeNormalDistRT = cubeNormalDistRT_A;
            writeCubeColorRT = cubeColorRT_B; writeCubeNormalDistRT = cubeNormalDistRT_B;
            writeCubeCamColor = cubeCamColor_B; writeCubeCamNormalDist = cubeCamNormalDist_B;
        }

        if (params.enableVolumetrics) {
            if (writeVolumeCubeRT === volumeCubeRT_B) {
                readVolumeCubeRT = volumeCubeRT_B;
                writeVolumeCubeRT = volumeCubeRT_A;
                writeVolumeCubeCam = volumeCubeCam_A;
            } else {
                readVolumeCubeRT = volumeCubeRT_A;
                writeVolumeCubeRT = volumeCubeRT_B;
                writeVolumeCubeCam = volumeCubeCam_B;
            }
        }

        let tempGI = readTemporalRT; readTemporalRT = writeTemporalRT; writeTemporalRT = tempGI;
        let tempSsr = readTemporalSsrRT; readTemporalSsrRT = writeTemporalSsrRT; writeTemporalSsrRT = tempSsr;
        let tempVolume = readTemporalVolumeRT; readTemporalVolumeRT = writeTemporalVolumeRT; writeTemporalVolumeRT = tempVolume;

        previousProbePos.copy(currentProbePos);
        previousCameraPos.copy(camera.position);
        temporalHistoryValid = true;
        probeFrameCount++;
        volumeFrameCount = params.enableVolumetrics ? (volumeFrameCount + 1) : 0;
        frameIndex++;
        timingProfiler.endFrame();
        timingProfiler.results['Probe SSR Trace'] = params.probeSSR ? (timingProfiler.results['Probe GI Trace'] || 0.0) : 0.0;
        timingProfiler.results['Probe Volume Capture'] = params.enableVolumetrics ? (timingProfiler.results['Probe Volume Trace'] || 0.0) : 0.0;
        updateTimingPanel();
        frames++; if(now - lastFpsTime >= 1000) { document.getElementById('fps').innerText = frames; frames = 0; lastFpsTime = now; }
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight); displayMat.uniforms.uAspect.value = window.innerWidth / window.innerHeight; resizeRenderTargets();
    });
    previousCameraPos.copy(camera.position);
    animate();
}
