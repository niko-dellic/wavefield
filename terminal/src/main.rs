use anyhow::Result;
use clap::Parser;
use wavefield::{app, cli::Cli};

fn main() -> Result<()> {
    let cli = Cli::parse();
    app::run(cli)
}
