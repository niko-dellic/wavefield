pub mod ansi;
pub mod cymatic;
pub mod kitty;

#[derive(Debug, Clone)]
pub struct FrameBuffer {
    pub width: usize,
    pub height: usize,
    pixels: Vec<[f32; 3]>,
}

impl FrameBuffer {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![[0.0, 0.0, 0.0]; width * height],
        }
    }

    pub fn clear(&mut self, color: [f32; 3]) {
        self.pixels.fill(color);
    }

    pub fn set(&mut self, x: usize, y: usize, color: [f32; 3]) {
        if x < self.width && y < self.height {
            self.pixels[y * self.width + x] = color;
        }
    }

    pub fn get(&self, x: usize, y: usize) -> [f32; 3] {
        self.pixels[y * self.width + x]
    }
}
