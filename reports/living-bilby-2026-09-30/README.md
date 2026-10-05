# Generated artwork verification

Current captures use the approved generated PNGs and sprite sheets directly.

- `01-home.png`: automatic night scene, sleeping Bilby, mock balance after purchase.
- `02-receive.png`: receiving illustration on the personal QR ticket.
- `03-gift-counter.png`: complete gift-wrapping pose with corrected edge spacing.
- `06-welcome.png`: Hello bubble and waving sprite.
- `07-burrow-320.png`: watering pose and complete amount at 320 × 740.
- `08-keepsakes.png`: organizing sprite, with the duplicate drawn album removed.
- `09-demo-gift-complete.png`: completed fictional gift purchase and demo card.

Other captures are at 390 × 844. Files under `superseded-vector/` show an earlier rejected character treatment and are retained only as design history. Any identifiers or card details in these captures are fictional local mock data.

The live welcome wave advanced to the next atlas cell and returned to its resting frame. Motion off leaves Home's breathing transform at `scaleY(1)`. The original preference was restored. A mock $10 gift purchase plus $0.25 fee completed without a navigation loop; fresh previews reported zero console errors.

Validation: 121 tests in 12 files, TypeScript, Expo lint (zero errors; five existing style warnings), Android Hermes export with all 14 character assets. Physical-device rendering and biometrics are not covered by these checks.
