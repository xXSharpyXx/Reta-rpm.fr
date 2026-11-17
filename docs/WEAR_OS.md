# La montre Wear OS (Galaxy Watch 4 et suivantes)

L'appli montre suit la séance qui tourne sur le téléphone Android. Le téléphone reste la référence :
la montre affiche, valide et mesure, mais c'est le téléphone qui enregistre.

- **Pendant une série** : l'exercice en cours, le numéro de série (`Série 2/4`, les échauffements à
  part), la charge et les reps prévus, et un gros bouton **Valider la série**.
- **Pendant le repos** : le temps restant en grand avec un anneau, `−15` / `+15`, **Passer**, la
  série suivante en petit, et une vibration à la fin (écran éteint aussi).
- **Toute la séance** : le rythme cardiaque, mesuré par Health Services et envoyé au téléphone avec
  l'heure de chaque mesure.
- **Sans séance** : « Aucune séance en cours ». Elle apparaît dès qu'une séance démarre sur le
  téléphone (et l'appli s'ouvre toute seule sur la montre, si celle-ci est à portée).

Rien ne sort de tes deux appareils : le lien passe par le Data Layer de Wear OS (Bluetooth ou
Wi-Fi entre la montre et le téléphone), sans compte ni serveur.

## Comment ça marche

```
téléphone (page web)                téléphone (natif)                     montre
lib/watch-sync.js  ── snapshot ──▶  WatchBridgePlugin ── DataItem ──▶  PhoneListenerService → Session
                                    /reta/snapshot                     (écran : MainActivity)
lib/watch-sync.js  ◀── drain ────  WatchStore  ◀── WatchListenerService ◀── message /reta/events
  setDone, restAdd, restSkip        watch-events.json                  PhoneLink (boîte d'envoi)
  mergeWatchHr  ◀── readHr ──────   heart-rate/<id>.json  ◀── hrSamples ── SessionService (cardio)
```

- **Téléphone → montre** (`DataClient`) : à chaque changement de la séance, la page envoie le même
  instantané qu'à l'Apple Watch (`buildSnapshot`), plus l'heure du téléphone et la couleur
  d'accent. Google Play services garde le dernier et le livre dès que la montre revient à portée.
- **Montre → téléphone** (`MessageClient`) : chaque appui devient un événement avec son id,
  écrit d'abord dans une boîte d'envoi sur la montre et retiré seulement quand le message est parti.
  Sur le téléphone, `WatchListenerService` l'écrit dans une file que la page applique une seule
  fois, avec les actions de l'écran Séance (la même chose qu'un appui sur le téléphone, repos
  compris).
- **Rythme cardiaque** : `SessionService` est un service au premier plan de type `health`. Il
  démarre un exercice Health Services (`STRENGTH_TRAINING`) et envoie les mesures toutes les 10 s.
  Le téléphone les range dans **un fichier par séance**, dans les fichiers privés de l'appli :
  `files/heart-rate/<id de la séance>.json`, au format
  `{ "wid": "...", "samples": [[horodatage en ms, bpm], ...] }`, triées, sans doublon. Une fois la
  séance terminée, la page en tire aussi le cardio de chaque série et de la séance
  (`lib/heart-rate.js`, `src: 'wear'`), affiché comme celui de l'Apple Watch.

### Les cas limites

- **Montre déconnectée en pleine séance** : le téléphone continue normalement, sans erreur. La
  montre continue de compter le repos et garde ses appuis et ses mesures dans sa boîte d'envoi ;
  tout part quand le lien revient, dans l'ordre. Un appui sur le repos vieux de plus d'une minute
  est ignoré (le repos est fini depuis longtemps).
- **Séance terminée ou abandonnée sur le téléphone** : la montre repasse sur « Aucune séance en
  cours » et arrête la mesure. Les mesures arrivées après coup sont quand même rangées dans la
  séance enregistrée.
- **Appli montre ouverte sans séance** : elle l'affiche, et rien ne tourne.
- **Montre sans permission cardio** : tout marche sauf la mesure ; une ligne « Cardio coupé :
  touche pour autoriser » le rappelle.

### Pourquoi le même applicationId et la même clé

Le Data Layer ne relie que deux applis qui ont **le même applicationId et la même signature**.
Le module `frontend/android/wear` reprend donc `ch.duartesantos.opengym` avec le suffixe `.test`
en debug (comme l'APK du téléphone) et signe avec la même clé, `frontend/android/app/reta-debug.keystore`.
Ne change jamais l'un sans l'autre.

## Obtenir les APK sur GitHub Actions

1. Pousse la branche `salles-et-da` (ou onglet **Actions** → **Android APK** → **Run workflow**).
2. Attends que le run soit vert (10 à 15 minutes).
3. En bas de la page du run, dans **Artifacts**, télécharge :
   - `reta-rpm-apk` : l'APK du téléphone (à réinstaller, il contient le nouveau pont montre) ;
   - `reta-rpm-wear-apk` : l'APK de la montre.
4. Dézippe les deux.

## Installer sur la Galaxy Watch 4 (débogage sans fil)

Sur l'ordinateur, il faut `adb`, qui fait partie des « SDK Platform-Tools » gratuits de Google :
télécharge le zip pour Windows depuis
<https://developer.android.com/tools/releases/platform-tools>, dézippe-le, et ouvre un terminal
dans le dossier `platform-tools`.

Sur la montre :

1. **Paramètres → À propos de la montre → Logiciel**, touche **Version du logiciel** 5 fois :
   « Mode développeur activé ».
2. **Paramètres → Options de développement** : active **Débogage ADB**, puis **Débogage sans fil**
   (accepte).
3. Montre et ordinateur sur **le même Wi-Fi**. Si la montre reste en Bluetooth, coupe le Bluetooth
   de la montre le temps de l'installation.
4. Dans **Débogage sans fil**, touche **Associer un nouvel appareil** : la montre affiche une
   adresse `IP:port` et un code à 6 chiffres.

Sur l'ordinateur :

```bash
adb pair 192.168.1.42:37199 123456
```

```bash
adb connect 192.168.1.42:41235
```

```bash
adb -s 192.168.1.42:41235 install -r wear-debug.apk
```

(`pair` prend l'adresse et le code de l'écran d'association ; `connect` prend l'adresse affichée
sur l'écran **Débogage sans fil** lui-même, dont le port est différent.) Rallume le Bluetooth de
la montre ensuite.

Le téléphone s'installe comme avant (l'APK depuis le gestionnaire de fichiers), ou par adb s'il est
branché.

## À activer

**Sur la montre**, au premier lancement de Reta-rpm.fr, accepte :
- **Capteurs corporels** (ou « Données de santé : fréquence cardiaque » sur Wear OS 6) ;
- **Activité physique** ;
- **Notifications** (la notification « Séance en cours » est celle qui garde la mesure écran éteint).

Si tu as refusé : **Paramètres → Applications → Reta-rpm.fr → Autorisations**.

**Sur le téléphone** :
- la montre associée dans **Galaxy Wearable**, Bluetooth allumé ;
- la nouvelle version de l'APK téléphone installée (même build GitHub que la montre) ;
- rien d'autre : pas de nouvelle permission. Si les validations depuis la montre tardent écran
  verrouillé, mets la batterie de Reta-rpm.fr sur **Non restreinte**.

## Vérifier que le cardio arrive dans la base

1. Lance une séance sur le téléphone : la montre l'affiche, et « ♥ 92 » apparaît sous le bouton
   après quelques secondes.
2. Fais au moins une ou deux séries en les validant sur la montre, attends 20 secondes.
3. Branche le téléphone en USB (ou débogage sans fil du téléphone), puis regarde le fichier
   (c'est possible parce que l'APK est une build debug) :

```bash
adb shell run-as ch.duartesantos.opengym.test ls -l files/heart-rate
```

```bash
adb shell run-as ch.duartesantos.opengym.test cat files/heart-rate/ID_DE_LA_SEANCE.json
```

   Tu dois voir `{"wid":"…","samples":[[1763380000000,92],[1763380001000,94],…]}`, et le fichier
   grossir pendant la séance.
4. Termine la séance : dans l'historique, ses séries affichent leur cardio (`♥ moyenne/max`).

Rien n'arrive ? Vérifie, dans cet ordre : les deux APK viennent du même run GitHub (même clé),
la permission Capteurs corporels sur la montre, la notification « Séance en cours » visible sur la
montre pendant la séance. `adb logcat` sur la montre montre les erreurs de Health Services.
