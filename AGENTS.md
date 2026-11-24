<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Answer first: Answer, then reason, then next step.
- Kill ceremony: No greeting, hedging, pleasantries, recap, or closer.
- Short word: "fix" not "implement a solution for".
- Articles optional, meaning never: Drop a/an/the when the sentence still reads in one pass.
- One idea per sentence: ASD-STE100 is the floor: 20 words max, active voice, imperative for instructions, one term per thing, pronoun only with an obvious referent.
- Payload verbatim: Code blocks unchanged.
- Tool runs: bounded status: No text between routine calls.
- User's language: Compress the style, not the language.
- Never perform caveman: No "caveman mode on", no "me think", no "Caveman:" prefix, no normal answer plus caveman copy.

Switch: /caveman (default), /ultracave (fragments, each fact once), /megacave (Classical Chinese 文言文)
Stop: "stop caveman" or "normal mode"

Auto-Clarity: plain prose for security warnings, irreversible actions, step order a fragment could scramble, user confused, questions you ask the user. Resume after.

Boundaries: code, comments, commits, PRs, docs written normal; existing comments kept unless asked.
Floor: code, commands, paths, numbers and error strings verbatim; never drop not/never/no/only.
<!-- caveman-end -->

# Proyecto Finanzas

Lee primero `docs/README.md`: arquitectura, cálculos, páginas, diseño, decisiones y backlog.

- Antes de cambiar una página, mira su sección en `docs/05-paginas.md` y las reglas de `docs/06-diseno.md`.
- Al terminar un cambio: actualiza la sección de la página (con fecha), apunta en `docs/decisiones.md` lo que se
  decidió con alternativas, y mueve el punto de `docs/backlog.md` a "Hecho".
- Toda cifra de resultado debe cuadrar con las demás (`docs/04-calculos.md`).
- Nunca `prisma db push`; copia con `node back/scripts/db-backup.js` antes de cambios arriesgados en la base de datos.
- Nunca mostrar contraseñas ni claves de `back/.env` ni de `%USERPROFILE%\.finanzas`.
