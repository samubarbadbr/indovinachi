# Indovina chi è l'intruso — Documentazione tecnica

Web app offline di deduzione sociale, in stile "fascicolo riservato".
Nessun server, nessun database online, nessun login: tutto gira nel browser
del telefono che passa di mano in mano tra i giocatori.

---

## 1. Architettura

```
┌─────────────────────────────────────────────┐
│                index.html                    │
│  (tutte le schermate come <section> nascoste │
│   /mostrate via classe .is-active)           │
└───────────────┬───────────────────────────────┘
                │
       ┌────────┴────────┐
       │                 │
  css/style.css      js/words.js  → database coppie di parole (const, in memoria)
  (design system)         │
                     js/app.js   → stato di gioco + logica + eventi DOM + temi
                           │
                     localStorage → statistiche e tema scelto (unici dati salvati)
                           │
                     sw.js + manifest.json → PWA installabile, cache offline
```

Nessuna chiamata di rete viene mai effettuata: `words.js` contiene l'intero
database come costante JavaScript caricata insieme alla pagina.
Il service worker mette in cache l'intero "app shell" al primo avvio, quindi
tutte le visite successive funzionano anche in aereo/senza rete.

Dati persistiti in `localStorage` (nessun altro dato lascia il telefono):
- `secretAgent.stats.v1` — partite giocate, vittorie infiltrati/civili, ruoli assegnati
- `secretAgent.theme.v1` — il tema colore scelto

## 2. Wireframe (flusso schermate)

```
HOME
 ├─ Nuova partita ─► Numero giocatori ─► Infiltrati/Jolly/Categorie ─► Timer
 │                                                                       │
 │                                                                       ▼
 │                                                            AVVIA MISSIONE
 │                                                                       │
 │                                                                       ▼
 │                                                        DISTRIBUZIONE RUOLI
 │                                                     (passa il telefono N volte)
 │                                                                       │
 │                                                                       ▼
 │                                                              DISCUSSIONE
 │                                                            (timer opzionale)
 │                                                                       │
 │                                                                       ▼
 │                                                                VOTAZIONE
 │                                                        (passa il telefono N volte)
 │                                                                       │
 │                                                                       ▼
 │                                                               RIVELAZIONE
 │                                                       (vincitori, ruoli, parole)
 │                                                          │              │
 │                                                       Rigioca         Menu
 ├─ Regole      (statica, spiega il gioco)
 ├─ Statistiche (partite, vittorie, ruolo più assegnato)
 └─ Tema        (6 palette colore selezionabili)
```

Ogni schermata di passaggio-telefono (distribuzione ruoli e votazione) segue
lo stesso pattern UX: **nome del prossimo giocatore → tocco per rivelare →
azione privata → nascondi/conferma → passa al successivo**, così l'esperienza
resta identica e prevedibile in entrambe le fasi.

## 3. Design system

**Tema visivo:** dossier notturno da agenzia di intelligence — nero-blu
profondo, timbro in ceralacca, titoli in monospace da "documento riservato".
Il logo è una lente d'ingrandimento con un punto interrogativo, coerente col
nome del gioco (invece del vecchio timbro con segno di spunta).

| Token | Valore predefinito | Uso |
|---|---|---|
| `--bg` | `#0B0F14` | sfondo principale |
| `--surface` | `#171F2A` | card, input, chip |
| `--surface-2` | `#1E2733` | stati attivi/hover |
| `--brass` / `--brass-bright` | `#C9A227` / `#E4C158` | accento primario, **cambia col tema** |
| `--alert` / `--alert-bright` | `#B4423C` / `#D3554E` | infiltrato, allarme, timer in scadenza — **fisso in ogni tema** |
| `--ok` / `--ok-bright` | `#3E8E63` / `#4FAE7B` | vittoria civili nelle statistiche — **fisso in ogni tema** |
| `--text` / `--text-dim` / `--text-faint` | `#ECEFF3` / `#9AA7B4` / `#5C6773` | gerarchia testo |

**Tipografia:** due famiglie di sistema (nessun font esterno, per restare
100% offline): `Courier New`/monospace per titoli, numeri e "timbri"; system-ui
sans-serif per il corpo del testo, per la massima leggibilità.

**Elemento firma:** il **dossier** della schermata di rivelazione ruolo — una
card che si apre con un piccolo "timbro" TOP SECRET in alto a destra, un
lampo dorato al tocco e una vibrazione tattile (se supportata).

**Layout:** mobile-first a schermo singolo, un compito per schermata,
pulsante primario sempre in un footer fisso raggiungibile col pollice (mai
più assoluto/flottante, per evitare overflow orizzontali su qualunque
dispositivo), transizioni morbide tra le schermate, rispetto di
`prefers-reduced-motion`.

## 4. Sistema di temi colore

Dalla home → **Tema** si sceglie tra 6 palette: Ottone (default), Zaffiro,
Ametista, Smeraldo, Corallo, Argento. Cambia solo il colore d'accento
(pulsanti, timbro, bordi attivi): il **rosso dell'infiltrato** e il **verde
di vittoria civili** restano sempre uguali in ogni tema, per non creare
ambiguità durante il gioco. La scelta viene salvata in `localStorage` e
applicata automaticamente alle partite successive.

Tecnicamente: un attributo `data-theme` sull'elemento `<html>` sovrascrive
le variabili CSS `--brass` / `--brass-bright`; nessun JavaScript ridondante,
tutta l'interfaccia si ridipinge da sola perché ogni componente usa quelle
variabili.

## 5. Struttura cartelle

```
secret-agent/
├── index.html          Tutte le schermate dell'app (SPA a sezioni)
├── manifest.json        Configurazione PWA (nome, icone, colori, standalone)
├── sw.js                Service worker: cache offline dell'app shell (v7)
├── css/
│   └── style.css        Design system, temi colore, stili di tutte le schermate
├── js/
│   ├── words.js          Database coppie di parole (25 categorie, 750 coppie)
│   └── app.js            Stato di gioco, navigazione, timer, voti, statistiche, temi
└── icons/
    ├── icon-192.png       Lente d'ingrandimento con punto interrogativo
    ├── icon-512.png
    └── icon-maskable-512.png
```

## 6. Come giocarci dal proprio telefono

**Opzione rapida (senza installare nulla):** trasferisci la cartella `secret-agent`
sul telefono (email a te stesso, Drive/Dropbox, cavo USB, AirDrop) ed apri
`index.html` con il browser. Funziona subito, anche offline.

**Opzione consigliata (vera app installabile, con icona in home):** serve un
piccolo hosting, anche gratuito e senza registrazione:

1. Vai su **[app.netlify.com/drop](https://app.netlify.com/drop)** dal computer.
2. Trascina la cartella `secret-agent` (o lo zip estratto) nella pagina.
3. In pochi secondi ottieni un link tipo `nome-a-caso.netlify.app`: aprilo dal telefono.
4. Su Android/Chrome: menu (⋮) → **Aggiungi a schermata Home**.
   Su iOS/Safari: icona Condividi → **Aggiungi a Home**.
5. Da quel momento l'app si apre a schermo intero, con la sua icona, senza
   barra del browser — e funziona offline anche in aereo, perché il service
   worker mette in cache tutto al primo avvio.

Se avevi già installato la versione precedente: apri di nuovo l'app con
connessione attiva almeno una volta, il service worker aggiornato
sostituirà automaticamente i file vecchi in cache.

In alternativa vanno bene anche GitHub Pages o qualunque altro hosting
statico gratuito: una volta pubblicata, l'app resta comunque 100% offline
nell'uso (nessuna chiamata di rete durante il gioco).

## 7. Database parole (meccanica "coppie simili", stile Undercover)

L'infiltrato non riceve "nessuna parola": riceve una **parola simile ma
diversa** da quella dei civili (es. civili: *Pane* → infiltrato: *Impasto*),
così può bluffare con indizi plausibili senza conoscere la parola esatta.

`js/words.js` contiene `WORD_PAIRS`: **750 coppie** su **25 categorie** —
Cibo, Animali, Film, Oggetti, Luoghi, Sport, Tecnologia, Professioni, Natura,
Musica, Trasporti, Scienza, Vestiti, Corpo Umano, Feste, Scuola, Colori,
Emozioni, Materiali, Spazio, Fantasia, Giochi, Bevande, Geografia, Casa. Le
categorie si possono filtrare nel setup; se nessuna è selezionata, si pesca
da tutte.

## 8. Changelog

- **Fix bug pulsante fuori schermo** nella schermata di distribuzione ruoli:
  il pulsante finale era posizionato in `position: absolute`, e la regola
  `.screen{ overflow-y: auto }` (senza un `overflow-x` esplicito) faceva sì
  che il browser trattasse anche l'asse orizzontale come scorrevole,
  causando lo scroll verso destra visto sia da telefono che da PC. Risolto
  spostando il pulsante in un footer normale (come nelle altre schermate) e
  aggiungendo `overflow-x: hidden` esplicito.
- **Rinominata l'app** in "Indovina chi è l'intruso".
- **Nuovo logo**: lente d'ingrandimento con punto interrogativo, al posto
  del timbro con segno di spunta.
- **Aggiunto il sistema di temi colore** (6 palette, sezione "Tema" dalla home).
- **Aggiunto l'apripista della discussione**: all'inizio della fase di
  discussione l'app indica chi parla per primo, scelto a caso **escludendo
  sempre gli infiltrati** — altrimenti chi apre senza avere alcun indizio si
  tradirebbe subito.
- **Semplificata la schermata finale**: rimosso il verdetto automatico
  ("Missione compiuta" / "Copertura riuscita" e la frase su chi ha vinto),
  che poteva risultare fuorviante nelle partite con più infiltrati. Restano
  ben visibili la parola dei civili, quella dell'infiltrato, i voti e il
  fascicolo completo dei ruoli: il gruppo tira le conclusioni da sé.
- **Rimosso il pulsante schermo intero** dalla home (pensato per l'uso da
  browser desktop, non necessario giocando da telefono).
- **Footer sempre visibile senza scroll**: nelle schermate con pulsanti in
  fondo (in particolare la schermata finale con Rigioca/Menu), il contenuto
  scorre internamente ma i pulsanti restano sempre a portata di pollice.
- **Aggiunto un vero tema chiaro** ("Chiaro" nella schermata Tema): a
  differenza degli altri accenti, cambia anche sfondo e superfici, non solo
  il colore. Il tema scuro resta quello di default.
- **Selezione multipla categorie resa a prova di dubbio**: `getRandomPair`
  ora unisce in un unico mazzo tutte le coppie di tutte le categorie
  selezionate e ne estrae una a caso da lì, invece di scegliere prima la
  categoria e poi la parola — stesso risultato ma zero ambiguità, verificato
  con migliaia di estrazioni simulate. Aggiunto anche un contatore live
  ("N categorie selezionate · N parole nel mazzo") e i pulsanti rapidi
  "Seleziona tutte" / "Nessuna" nella schermata di setup, per avere sempre
  sott'occhio cosa è davvero selezionato.
- **Anti-ripetizione**: la stessa coppia di parole non può ripresentarsi
  nelle 6 partite immediatamente successive (quando il mazzo selezionato è
  abbastanza grande da permetterlo), utile rigiocando più volte di fila con
  poche categorie attive.
- **Reveal ruolo a "press & hold"**: il ruolo non si vede più con un tap che
  resta aperto finché non lo chiudi tu — ora si vede *solo* mentre tieni il
  dito premuto sulla card, e sparisce all'istante al rilascio. Un pulsante
  separato ("Ho visto, passa al prossimo") si abilita solo dopo la prima
  occhiata e fa avanzare al giocatore successivo. Funziona con dito, mouse e
  pennino (Pointer Events) ed è accessibile anche da tastiera (Invio/Spazio
  tenuti premuti). Il gameplay non cambia: cambia solo *come* si guarda la
  propria carta.
- **Feedback aptico differenziato**: vibrazione doppia e decisa quando scopri
  di essere l'infiltrato, leggera per tutti gli altri ruoli; piccolo impulso
  ad ogni secondo negli ultimi 5 secondi del timer di discussione; tocco
  leggero su tutti i pulsanti principali. Nessun errore sui dispositivi che
  non supportano la vibrazione (fallback silenzioso).
- **Audio sintetico opzionale**: piccoli suoni generati al volo con la Web
  Audio API (nessun file esterno) per click, conferme, voto e reveal — il
  suono del reveal è **volutamente identico per ogni ruolo** (il telefono
  passa di mano tra persone vicine: un suono diverso per l'infiltrato
  sarebbe udibile da chi sta accanto e lo tradirebbe subito), bip ritmico
  negli ultimi secondi del timer. Interruttore "Effetti sonori" nella
  schermata Tema, ricordato tra una partita e l'altra.
- **Memoria dei giocatori**: l'ultimo elenco di nomi usato viene salvato in
  automatico; il pulsante "Ricarica ultimi giocatori" nella schermata di
  setup lo ripristina in un tocco, utile quando si gioca spesso con lo
  stesso gruppo.
- **Micro-animazioni**: piccolo effetto flip sul dossier tra stato nascosto
  e rivelato, leggero shake di conferma sul voto appena espresso — tutto
  rispetta `prefers-reduced-motion` come il resto dell'app.
- **Easter egg discreto**: nella schermata finale compare una piccola
  didascalia ironica scelta a caso, basata solo sul fatto verificato (chi è
  stato eliminato) e non su un verdetto complessivo sulla partita — resta
  quindi corretta anche con più infiltrati, coerentemente con la scelta di
  aver tolto il verdetto automatico.
- **Fix privacy audio**: il suono del reveal era inizialmente diverso per
  l'infiltrato (tono cupo) rispetto agli altri ruoli (tono chiaro) — un
  bystander vicino al giocatore avrebbe potuto riconoscere l'infiltrato
  solo dal suono, senza nemmeno vedere lo schermo. Ora il suono è identico
  per tutti i ruoli; resta invece differenziata solo la vibrazione, che è
  privata e la sente esclusivamente chi tiene il telefono in mano.
