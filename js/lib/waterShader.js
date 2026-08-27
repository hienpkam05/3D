import * as THREE from 'three';

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      colorDeep: { value: new THREE.Color('#000') },
      colorShallow: { value: new THREE.Color('#49b6d6') },
      colorFoam: { value: new THREE.Color('#dff6ff') },
      colorBack: { value: new THREE.Color('#0a3f52') },
      opacity: { value: 0.9 }, waveAmp: { value: 0.1 }, waveFreq: { value: 0.01 }, waveSpeed: { value: 1 },
    },
    vertexShader: `
      uniform float time, waveAmp, waveFreq, waveSpeed;
      varying vec3 vWorldPos; varying vec3 vNormal;
      void main() {
        vec3 pos = position; float t = time * waveSpeed;
        pos.y += (sin((pos.x+t)*waveFreq)*0.5 + cos((pos.z-t)*waveFreq*1.3)*0.5 + sin((pos.x+pos.z+t)*waveFreq*0.7)*0.5) * waveAmp;
        vec4 wp = modelMatrix * vec4(pos,1.0); vWorldPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 colorDeep, colorShallow, colorFoam, colorBack; uniform float opacity;
      varying vec3 vWorldPos; varying vec3 vNormal;
      void main() {
        vec3 vd = normalize(cameraPosition - vWorldPos);
        float f = pow(1.0 - max(dot(normalize(vNormal), vd), 0.0), 3.0);
        vec3 base = mix(colorDeep, colorShallow, f+0.2);
        vec3 c = mix(base, colorFoam, smoothstep(0.65,0.95,f));
        if (!gl_FrontFacing) c = mix(colorBack, base, 0.3);
        gl_FragColor = vec4(c, opacity);
      }`,
  });
}
