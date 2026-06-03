use crate::cli::PaletteName;

#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub background: [f32; 3],
    pub low: [f32; 3],
    pub mid: [f32; 3],
    pub high: [f32; 3],
    pub hot: [f32; 3],
}

impl Palette {
    pub fn from_name(name: PaletteName) -> Self {
        match name {
            PaletteName::Terminal => Self {
                background: [0.0, 0.0, 0.0],
                low: [0.42, 0.88, 1.0],
                mid: [0.78, 0.92, 0.44],
                high: [1.0, 0.72, 0.98],
                hot: [1.0, 1.0, 0.92],
            },
            PaletteName::Mono => Self {
                background: [0.0, 0.0, 0.0],
                low: [0.76, 0.76, 0.76],
                mid: [0.9, 0.9, 0.9],
                high: [1.0, 1.0, 1.0],
                hot: [1.0, 1.0, 1.0],
            },
            PaletteName::Ember => Self {
                background: [0.0, 0.0, 0.0],
                low: [0.95, 0.22, 0.08],
                mid: [1.0, 0.62, 0.16],
                high: [1.0, 0.94, 0.52],
                hot: [1.0, 0.98, 0.86],
            },
        }
    }
}

pub fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    let t = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

pub fn add_scaled(color: &mut [f32; 3], value: [f32; 3], scale: f32) {
    for i in 0..3 {
        color[i] = (color[i] + value[i] * scale).clamp(0.0, 1.0);
    }
}
