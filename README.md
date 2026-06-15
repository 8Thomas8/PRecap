# PRecap

**Français** · [English](README.en.md)

PRecap te fait, **en une commande**, un récap de ton activité GitHub d'un jour donné - PR mergées, ouvertes, fixups, PR juste touchées - sous forme d'une page web. Tout est **local**, **sans IA** et **sans serveur** : ça lit tes PR via le CLI `gh` et génère un fichier HTML autonome que tu ouvres dans ton navigateur.

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20TypeScript%20%2B%20Tailwind%20v4-blue)

> [!IMPORTANT]
> **PRecap accède à GitHub en lecture seule, via ton `gh` - rien d'autre.** Il ne fait que **lire** des PR/commits ; il n'écrit, ne merge, ne pousse, ne supprime **jamais** rien. Aucun token n'est stocké dans le projet : c'est ton `gh` (déjà connecté sur ton poste) qui porte l'authentification.

## Installation (une seule fois)

```bash
git clone <repo> && cd precap
nvm use          # Node ≥ 20 (cf. .nvmrc → 24 ; le défaut machine est souvent trop vieux)
npm install
```

**Prérequis** : le CLI [`gh`](https://cli.github.com/) installé et connecté.

```bash
gh auth login    # une fois ; vérifie ensuite avec « gh auth status »
```

## Utilisation

La commande est **`npm run report -- --repos <tes repos>`** : elle classe ton activité du jour pour ces repos et ouvre le rapport dans le navigateur. Tu passes **toujours** tes repos - le plus simple est de les figer dans une fonction shell (ci-dessous).

> 💡 **Recommandé : une fonction shell** (dans `~/.zshrc` / `~/.bashrc`) qui fige tes repos et te laisse dans ton dossier courant :
> ```bash
> precap() { ( cd ~/path/to/precap && npm run report -- --repos acme/web,acme/api "$@" ); }
> ```
> Ensuite, juste **`precap`** (ou `precap 2026-06-10`, `precap --force`). Le sous-shell `( … )` exécute le `cd` sans changer ton répertoire courant, et `"$@"` transmet tes arguments (ce qu'un simple `alias` ne sait pas faire). Pour changer de repos : tu édites la fonction.

### Exemples

```bash
# Le récap du dernier jour ouvré (vendredi si on est lundi, sinon la veille)
precap

# Un jour précis
precap 2026-06-10

# Refaire un jour déjà généré (ex. après un rebase/merge tardif)
precap --force

# Écrire le rapport ailleurs que dans dist/report.html
precap -o /tmp/recap.html

# Sans la fonction : on passe --repos à chaque fois
npm run report -- --repos acme/web 2026-06-10
```

### Bon à savoir

- **Le rapport est figé** : un jour déjà généré n'est pas recalculé (sauf `--force`). Pas besoin de re-générer un jour déjà fait.
- **En cas de souci** (repo mal orthographié, sans accès, ou `gh` pas connecté) : message clair dans le terminal, le repo fautif est ignoré, les autres passent quand même.
- **Dans la page** : tu peux **filtrer l'affichage par repo** (les puces en haut) et **changer la langue FR/EN**. Rien d'autre - c'est un rapport, pas un dashboard interactif.
- **Le fichier est autonome** : `dist/report.html` embarque tout (HTML + CSS + données). Tu peux le rouvrir hors-ligne (`file://`) ou l'envoyer tel quel.
- **Chacun voit ses PR** : le rapport utilise l'auth de ton `gh`, donc personne ne partage de serveur ni de données.
- Options en plus : `--no-build` (saute le rebuild), `--no-open` (ou `PRECAP_NO_OPEN=1`, n'ouvre pas le navigateur).

---

## Pour aller plus loin

### Authentification GitHub (`gh`)

- Un `gh` connecté suffit : **pas de `.env`, pas de token dans le projet**. Le script shelle vers `gh`, qui porte lui-même l'auth.
- Vérifier : `gh auth status` - affiche le compte, les scopes et **où** le token est stocké.
- **Token recommandé** : un fine-grained PAT *read-only* (GitHub → *Settings → Developer settings → Fine-grained tokens*, permission **`Pull requests: Read-only`**, + `Contents: Read-only` si repos privés), limité aux dépôts concernés. Aucune permission en écriture n'est nécessaire.
- **Machine sans `gh auth login`** (autre poste, CI…) : exporter `GH_TOKEN=<PAT>` - `gh` honore nativement cette variable.
- **Node ≥ 20** (cf. `.nvmrc` → 24). Un garde-fou (`scripts/check-node.mjs`) bloque proprement les commandes si Node est trop vieux - pense à `nvm use`.

### Quels repos ? (stateless)

- PRecap est **sans état** : les repos viennent **uniquement** de `--repos`. Pas de fichier de config, pas de liste mémorisée - ce que tu passes est ce que tu obtiens.
- Pour changer ta liste : **édite ta fonction `precap`** (c'est le seul endroit où elle vit).
- Le rapport n'affiche que les repos passés ; les puces ne servent qu'à masquer/afficher à l'écran.
- `data.js` (local, gitignoré) garde en cache les jours déjà classifiés - c'est juste une optimisation, indépendante de la liste de repos.

### Langue (FR / EN)

Rapport bilingue. Par défaut la langue du **navigateur** ; le sélecteur **FR / EN** (en haut à droite) force le choix, mémorisé (`localStorage`) **seulement s'il diffère** du navigateur. Les libellés sont traduits **à l'affichage** (`src/i18n.ts`), donc changer de langue ne nécessite **aucune re-génération**.

### Comment ça marche (sous le capot)

```
                         npm run report
                               │
            ┌──────────────────┼───────────────────┐
            ▼                  ▼                    ▼
   ┌─────────────────┐   ┌───────────┐    ┌──────────────────┐
   │ scripts/lib.ts  │   │ vite build│    │  api.github.com  │
   │ (classification)│   │  (dist/)  │    │   via gh CLI     │
   └────────┬────────┘   └─────┬─────┘    └──────────────────┘
            │ écrit data.js    │ bundle + CSS         ▲
            └──────────┬───────┘                      │ lit PR/commits
                       ▼                              │
            dist/report.html  ◀──── inline (bundle + CSS + data) ──┘
            (un seul fichier, ouvrable en file://)
```

`npm run report` build le bundle (`vite build`, ≈ 100 ms), classifie le jour via `gh`, écrit les données dans `data.js`, puis inline le tout dans un `dist/report.html` autonome. Le rendu est **statique** : une fois généré, le HTML n'interroge plus rien.

> Pour itérer sur l'UI : `npm run dev` sert le bundle contre le `data.js` existant (sans `gh`, sans regénérer).

### D'où viennent les infos « Jira » ?

**D'aucun appel Jira.** Le ticket affiché sous une PR est déduit de ses métadonnées GitHub. La détection est **générique** (clé `PROJ-123`, n'importe quel projet/domaine) :

- **premier lien Jira du body** - `[label](https://<host>/browse/CLE)`, host quelconque - = le sujet affiché (clé + label) ;
- sinon, fallback sur une **clé de ticket dans le nom de branche** (`feature/PROJ-123-…`) ;
- aucun ticket trouvé → **rien affiché**.

C'est une heuristique sur la convention de rédaction des PR - si le body ment, le récap ment.

### Règles de classification (par jour Paris, ordre de priorité)

| Bucket | Règle |
|---|---|
| **Mergée** | `mergedAt` tombe ce jour (affiche la branche cible `baseRefName` ; badge `modif + merge` / `rebase + merge` si la branche a aussi reçu du contenu ce jour, sinon merge simple) |
| **Ouverte** | `createdAt` tombe ce jour, pas mergée le même jour (**tes PR uniquement**) |
| **Fixup** | PR pré-existante, **activité git réelle** ce jour : commit committé ce jour (`push`), ou `head_ref_force_pushed` sans nouveau contenu (`rebase`) |
| **Touchée sans push** | **tes PR** mises à jour ce jour **sans aucun push** (label, review, commentaire…) |

Une PR n'apparaît que dans un seul bucket.

> **PR des autres.** Sur les PR **ouvertes par quelqu'un d'autre**, seules **tes** actions remontent - un **merge** que tu as cliqué, ou des **commits / force-push** que tu as faits ce jour - avec un bandeau « **PR ouverte par @auteur** ». Pas de bucket « Ouverte » ni « Touchée sans push » pour les PR d'autrui.

### Péremption des données

- **Fenêtre glissante de 90 jours** (`KEEP_DAYS`, `scripts/lib.ts`) : à chaque génération, les jours plus vieux que `aujourd'hui − 90 j` sont purgés de `data.js`, pour tous les repos.
- `data.js` est **local et gitignoré** : jamais commité, propre à chaque poste. Le volume reste borné (quelques dizaines à centaines de Ko). Aucun entretien à faire.

### Limites connues

- **PR des autres** : seules tes actions de contenu (merge / push / rebase) remontent - pas leurs ouvertures, ni les PR seulement touchées (review/commentaire) par toi.
- La requête « PR des autres » est **bornée dans le temps** → une PR mergée par toi puis re-modifiée bien plus tard peut échapper.
- Recherche bornée à **200 PR par requête** : pour une date très ancienne sur un repo très actif, des PR peuvent manquer.
- « Touchée sans push » n'est fiable que pour les **jours récents** (`updatedAt` ne garde que la dernière activité).
- Les sujets Jira reposent sur la **convention de body** décrite ci-dessus - repos sans cette convention = sujets vides ou approximatifs.
