const WAVEFIELD_CONSOLE_ART = String.raw`
          ▓▓▓▓          
   ▓▓▓    ▓  ▓    ▓▓▓   
  ▓▓    ▓▓    ▓▓    ▓▓  
 ▓▓    ▓        ▓    ▓▓ 
 ▓     ▓        ▓     ▓ 
 ▓      ▓  ▓▓  ▓      ▓ 
       ▓  ▓  ▓  ▓       
   ▓▓ ▓  ▓    ▓  ▓ ▓▓   
  ▓  ▓    ▓▓▓▓    ▓  ▓  
  ▓    ▓        ▓    ▓  
▓▓    ▓ ▓  ▓▓  ▓ ▓    ▓▓
▓    ▓  ▓ ▓  ▓ ▓  ▓    ▓
▓    ▓  ▓ ▓  ▓ ▓  ▓    ▓
▓▓    ▓ ▓  ▓▓  ▓ ▓    ▓▓
  ▓    ▓        ▓    ▓  
  ▓  ▓    ▓▓▓▓    ▓  ▓  
   ▓▓ ▓  ▓    ▓  ▓ ▓▓   
       ▓  ▓  ▓  ▓       
 ▓      ▓  ▓▓  ▓      ▓ 
 ▓     ▓        ▓     ▓ 
 ▓▓    ▓        ▓    ▓▓ 
  ▓▓    ▓▓    ▓▓    ▓▓  
   ▓▓▓    ▓  ▓    ▓▓▓   
          ▓▓▓▓          
          `;

const WAVEFIELD_CONSOLE_STYLE =
  "color: #ff0000; font-family: monospace; white-space: pre;";

function widenConsoleArt(art: string) {
  return art
    .split("\n")
    .map((line) =>
      Array.from(line)
        .map((character) => `${character}${character}`)
        .join(""),
    )
    .join("\n");
}

export function logAttribution() {
  console.log(
    `%c${widenConsoleArt(WAVEFIELD_CONSOLE_ART)}

  Niko, 2026
    
    `,
    WAVEFIELD_CONSOLE_STYLE,
  );
}
