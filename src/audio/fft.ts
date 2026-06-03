export function fftRadix2(real: Float32Array, imag: Float32Array) {
  const size = real.length;

  for (let index = 1, swapIndex = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; swapIndex & bit; bit >>= 1) {
      swapIndex ^= bit;
    }
    swapIndex ^= bit;

    if (index < swapIndex) {
      const realValue = real[index];
      real[index] = real[swapIndex];
      real[swapIndex] = realValue;

      const imaginaryValue = imag[index];
      imag[index] = imag[swapIndex];
      imag[swapIndex] = imaginaryValue;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    const halfLength = length >> 1;

    for (let start = 0; start < size; start += length) {
      let phaseReal = 1;
      let phaseImaginary = 0;

      for (let offset = 0; offset < halfLength; offset += 1) {
        const even = start + offset;
        const odd = even + halfLength;
        const oddReal = real[odd] * phaseReal - imag[odd] * phaseImaginary;
        const oddImaginary = real[odd] * phaseImaginary + imag[odd] * phaseReal;

        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImaginary;
        real[even] += oddReal;
        imag[even] += oddImaginary;

        const nextReal =
          phaseReal * stepReal - phaseImaginary * stepImaginary;
        phaseImaginary =
          phaseReal * stepImaginary + phaseImaginary * stepReal;
        phaseReal = nextReal;
      }
    }
  }
}
