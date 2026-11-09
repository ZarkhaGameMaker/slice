# Slice

Application web pour suivre ses comptes bancaires : revenus, dépenses, opérations automatiques mensuelles et évolution du solde mois par mois.

## Lancer

**Double-cliquez sur `Slice.html`.** C'est tout : ce fichier contient toute l'application
(code, styles, police) et fonctionne sans Node, sans serveur et sans connexion Internet.

Les données sont enregistrées par le navigateur qui ouvre le fichier (Chrome ou Edge recommandés).
Pour les garder aussi dans un vrai fichier sur votre disque, utilisez **Ctrl+S** (voir *Fichier de comptes* plus bas).
Un bandeau orange apparaît si le navigateur refuse d'enregistrer (navigation privée, par exemple).

## Développer

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173. Après une modification du code, `npm run build` régénère `Slice.html`.

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement (rechargement à chaud) |
| `npm run build` | Vérification TypeScript, build, puis assemblage de `Slice.html` |
| `npm test` | Tests unitaires (dates, soldes, moyennes, import CSV, fichier de comptes) |

Les données du serveur de développement (`localhost`) et celles du fichier sont **séparées** :
enregistrez-les dans un fichier (Ctrl+S) d'un côté et ouvrez-le (Ctrl+O) de l'autre.

## Fonctionnalités

- **Revenus et dépenses** datés, avec catégorie et libellé ; clic sur une opération pour la modifier, corbeille pour la supprimer (avec « Annuler »).
- **Opérations automatiques mensuelles** (salaire, loyer…) : jour du mois au choix (5 par défaut).
  Si la date tombe un **samedi**, elle est avancée au vendredi ; un **dimanche**, reportée au lundi.
  Un jour absent du mois (31 en avril) est ramené au dernier jour. Chaque échéance peut être ignorée pour un mois donné.
- **Plusieurs comptes** dans un carrousel qu'on fait glisser (souris, doigt, flèches du clavier), plus une vue « Tous les comptes ».
  Le bouton **Réorganiser** (ou ⋮ → Réorganiser les comptes) change leur ordre par glisser-déposer ou avec les flèches.
  18 couleurs au choix ; la couleur du compte affiché devient la couleur d'accent de toute la page.
  L'étoile ☆ de la carte active (ou l'option du formulaire du compte) en fait le **compte principal**,
  sélectionné à l'ouverture de l'application.
  Le crayon ✎ ouvre la fiche du compte : on y change son nom, son solde de départ, sa couleur, et on peut le
  **supprimer** (avec ses opérations ; « Annuler » dans la notification les rétablit).
- **Comptes mis de côté** (fiche du compte → *Mettre ce compte de côté*) : pour une banque qu'on a quittée.
  Le compte sort du bandeau, du *Patrimoine*, de « Tous les comptes » et des formulaires, **mais toutes ses
  opérations sont conservées**. ⋮ → *Comptes mis de côté* les réaffiche quand on veut : ils reviennent dans le
  bandeau, en couleurs atténuées et marqués « De côté », avec leur graphique et leur historique complets.
  Un compte mis de côté ne peut pas être le compte principal ; il se remet en service par la même option.
- **Opérations exceptionnelles** : un cadeau reçu, un remboursement, un achat unique n'ont rien d'une habitude,
  mais ils faussent tous les indicateurs. L'interrupteur *Opération exceptionnelle* (fiche de l'opération, ou le
  bouton ✨ de la ligne dans la liste) la met de côté : **elle reste comptée dans le solde**, comme n'importe quelle
  opération, mais elle sort du bilan du mois, du taux d'épargne, de la moyenne par mois et de la prévision.
  Rien n'est supprimé, le drapeau se retire d'un clic (avec « Annuler »). La ligne porte un badge ✨ *Exceptionnel*,
  et le détail du bilan rappelle le montant mis de côté ainsi que la variation réelle du solde. Le graphique et
  la répartition, eux, continuent de montrer ce qui s'est réellement passé.
- **Groupes d'opérations** : vous avancez 96 € au restaurant, deux amis vous rendent 32 € chacun trois jours
  plus tard. Sans rien faire, la catégorie *Restaurant* enfle de 96 € et *Remboursement* de 64 € : trois lignes
  pour un repas à 32 €. Le bouton 🔗 d'une ligne ouvre *Regrouper des opérations*, où l'on coche les opérations
  à réunir. Le groupe retient alors **un seul montant**, par défaut son net (96 − 64 = 32 €), porté par
  l'**opération principale** — celle dont la catégorie reçoit ce montant. Les autres sont **secondaires** :
  elles restent dans la liste et dans le solde, mais ne comptent plus dans les catégories, les bilans, les
  moyennes ni la prévision. On peut aussi fixer le montant retenu à la main (et son sens), renommer le groupe,
  ajouter ou retirer des membres, ou le dissoudre. Un groupe peut réunir des opérations de mois ou de comptes
  différents ; la liste des candidates couvre 75 jours autour de l'opération de départ.
- **Indicateurs** : quatre tuiles, chacune avec son détail au survol (ou au toucher). Le détail s'ouvre
  toujours au même endroit, sur la grande courbe, où il a la place de dérouler sa liste.
  - *Revenus* et *Dépenses* : la liste des opérations qui composent le total. **Un clic sur une ligne la retire du
    total** — ou l'y ajoute, par exemple un revenu hors salaire, qui n'est pas compté par défaut. La tuile suit,
    *Réinitialiser* remet tout en place. Ces choix sont temporaires : rien n'est enregistré, les opérations ne
    sont pas modifiées et le reste de l'application (graphique, soldes, moyennes) n'en tient pas compte.
  - *Bilan du mois* : **tous les revenus de la période moins toutes les dépenses**, salaires et autres revenus
    confondus. Le détail donne le calcul — revenus (dont salaires et autres), dépenses, bilan, part des opérations
    encore à venir, total des opérations exceptionnelles mises de côté et part absorbée par les groupes, avec
    la variation réelle du solde en regard, effet des lignes retirées, et le calcul du taux d'épargne.
  - *Bilan des revenus* : la **soustraction des deux tuiles du dessus**, donc ce qu'il reste de vos seuls salaires
    une fois les dépenses payées. Allocations, remboursements et autres revenus n'y entrent pas, et les choix
    faits dans les deux détails y sont repris. C'est la réponse à « qu'est-ce que j'ai utilisé de mon seul
    salaire ? ».
- **Graphique par mois** : les mois sont collés de gauche à droite ; on fait glisser pour changer de mois (aimantation sur le mois le plus proche).
  Barres vertes/rouges = gains/dépenses du jour, courbe = solde (pointillés = prévision avec les échéances à venir).
  Survol d'un jour = détail des opérations et total du jour ; la frise sous le graphique permet de sauter à n'importe quel mois.
- **Prévision des mois à venir** : après aujourd'hui, la courbe ne se contente pas des opérations déjà connues
  (automatiques, opérations saisies à l'avance). On y ajoute votre **niveau habituel**, calculé sur les 12 derniers
  mois terminés — opérations exceptionnelles exclues — et réparti sur les jours restants : un mois à venir atteint donc le total de dépenses et de revenus
  que vous faites d'ordinaire. Les barres pâles montrent cette part estimée, le survol d'un jour l'affiche, et la
  tuile *Solde* reprend la même estimation pour la fin de la période.
  Un mois qui dépasse déjà son niveau habituel n'est pas gonflé, et tant qu'aucun mois n'est terminé il n'y a pas
  de prévision. Les montants réels ne sont jamais modifiés : l'estimation ne sert qu'à la courbe et au solde prévu.
- **Vos propres catégories** : dans un formulaire d'opération, le bouton *+ Nouvelle* sous les catégories en
  crée une (emoji + nom) et la sélectionne aussitôt. ⋮ → *Catégories…* ouvre la fenêtre complète : créer,
  renommer, et supprimer les vôtres (les opérations concernées retombent alors dans « Autre », et « Annuler »
  rétablit tout). Les catégories fournies avec l'application ne sont pas modifiables ; « Autre » reste toujours
  la dernière de la liste.
- **Répartition par catégorie** (treemap) : un carré par catégorie, de surface proportionnelle au montant du mois
  (dépenses ou revenus). Un clic sur un carré filtre la liste des opérations sur cette catégorie.
- **Moyenne par mois** : pour chaque catégorie, la moyenne mensuelle calculée sur les 3, 6 ou 12 derniers
  **mois terminés** (ou tout l'historique). Le mois en cours, les prévisions et les opérations exceptionnelles
  n'y sont jamais comptés, ils fausseraient la moyenne ; une catégorie absente d'un mois y compte pour 0 €. La barre de chaque ligne montre
  le poids de la catégorie, le survol en donne le détail (total, nombre d’opérations, mois concernés, montant du
  mois affiché) et un clic filtre la liste des opérations comme dans la répartition.
  En bas de l'encart : la moyenne toutes catégories, le mois affiché comparé à cette moyenne (l'écart en %
  n'apparaît que pour un mois terminé) et le bilan moyen (revenus − dépenses).
- **Début du mois au choix** (bouton 📅 au-dessus du graphique, ou ⋮ → Début du mois) :
  - *Mois calendaire* : du 1er au dernier jour ;
  - *D'un salaire au suivant* : chaque mois commence le jour où un revenu automatique est versé
    (week-ends décalés comme le versement) et se termine la veille du suivant ;
  - *Jour fixe* : le N de chaque mois.
  Graphique, indicateurs, répartition et opérations suivent ce découpage.
- **Mise en page tableau de bord** sur grand écran (16:9) : comptes en bandeau en haut ; actions, indicateurs et
  automatiques à gauche ; graphique (hauteur adaptée à l'écran), répartition et opérations à droite.
- **Import de relevés bancaires CSV** (⋮ → Importer un relevé bancaire, ou bouton ⤒ de la carte Opérations) :
  - format BoursoBank reconnu automatiquement (`dateOp;dateVal;label;category;…;amount;…;accountNum;accountLabel`),
    et la plupart des autres banques (colonnes Montant ou Débit/Crédit, dates JJ/MM/AAAA, UTF-8 ou Windows-1252) ;
  - aperçu avant import : compte de destination, catégorie proposée (modifiable), état de chaque ligne ;
  - **aucun doublon** : chaque ligne importée garde une empreinte (date, montant, libellé de la banque, rang
    pour les lignes identiques) ; réimporter un relevé, ou un relevé qui chevauche le précédent, n'ajoute que
    les nouvelles lignes ;
  - une ligne qui ressemble à une opération saisie à la main (même montant, ±3 jours) est signalée
    « doublon probable » et décochée ;
  - une ligne qui correspond à une opération automatique (ex. le salaire) la remplace pour ce mois ;
  - le compte de destination est retrouvé automatiquement lors des imports suivants ;
  - « Annuler » dans la notification retire tout l'import.
- **Fichier de comptes** (Chrome et Edge) : vos comptes dans un fichier `.json` de votre ordinateur,
  que l'application met à jour directement.
  - **⋮ → Enregistrer sous…** (Ctrl+Maj+S), ou le bouton *Enregistrer* à côté du titre : choisir où créer le fichier ;
  - **Enregistrer** (Ctrl+S) écrit dans le même fichier ; l'**enregistrement automatique** (activé par défaut,
    désactivable dans le menu) le fait après chaque modification ;
  - **Ouvrir un fichier…** (Ctrl+O) charge un fichier (les anciennes sauvegardes exportées s'ouvrent aussi) ;
  - l'indicateur à côté du titre montre l'état : *Enregistré à 14:32*, *Non enregistré*, *Enregistrement…* ;
    un clic enregistre ;
  - le fichier est retrouvé à la prochaine ouverture. Chrome peut redemander l'autorisation de le modifier :
    l'indicateur affiche alors *Cliquez pour autoriser* (choisir « Autoriser à chaque visite » évite la question) ;
  - fichier synchronisé (OneDrive…) : s'il a été modifié ailleurs, il est rechargé en revenant sur la page ;
    si des modifications attendaient aussi ici, l'application demande quelle version garder ;
  - fichier déplacé ou supprimé : l'indicateur propose *Enregistrer sous…* ;
  - *Charger la démo* et *Tout effacer* ferment le fichier sans jamais l'écrire ;
  - sur un navigateur sans cette fonction (Firefox), le menu propose *Télécharger une sauvegarde* / *Ouvrir une sauvegarde*.
- Thème sombre/clair, interface adaptée au mobile.

## Données

Tout est enregistré dans le `localStorage` du navigateur (clé `slice:v1`), rien n'est envoyé sur Internet.
Chaque navigateur a ses propres données : ouvrez toujours le fichier avec le même.
Vider les données du site efface la copie du navigateur : enregistrez vos comptes dans un fichier (Ctrl+S)
pour les garder à l'abri. Le fichier ouvert est mémorisé dans IndexedDB (base `slice`).

L'application s'appelait « Mes Comptes » : les comptes enregistrés sous l'ancien nom sont repris
automatiquement au premier lancement, et les fichiers `.json` déjà enregistrés restent lisibles
(un fichier est reconnu à son contenu, pas à son nom).

## Structure

```
Slice.html      l'application complète en un fichier (généré par npm run build)
scripts/single-file.mjs  intègre le JS et le CSS de dist/ dans ce fichier
src/
  lib/dates.ts        utilitaires de dates (heure locale)
  lib/finance.ts      règle du jour ouvré, échéances, soldes jour par jour, montants retenus (groupes), moyennes
  lib/store.ts        état de l'app (reducer), persistance, données de démo
  lib/categories.ts   catégories fournies + celles créées par l'utilisateur, couleurs des comptes
  lib/csv.ts          lecture des relevés CSV (encodage, séparateur, colonnes, dates, montants)
  lib/bankImport.ts   interprétation des lignes, catégories, détection des doublons
  lib/dataFile.ts     fichier de comptes : ouvrir, enregistrer, enregistrement automatique, conflits
  lib/motion.ts       ressort, glisser horizontal, largeur d'élément
  components/         carrousel, graphique (MonthStrip), listes, formulaires…
```
