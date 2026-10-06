# Mamoabio + SQLite

Version complète du site Mamoabio avec :
- HTML / CSS / JavaScript
- Node.js + Express
- SQLite avec better-sqlite3
- Authentification JWT
- rôles `admin` et `super_admin`
- gestion des produits
- upload de photos
- stock et disponibilité
- demandes clients
- gestion des utilisateurs réservée au Super Admin
- responsive + menu hamburger

## Installation

Installer Node.js 18+ puis :

```bash
npm install
npm start
```

Ouvrir :

http://localhost:3000

## Comptes de démonstration

### Admin
Email : `admin@mamoabio.com`
Mot de passe : `Admin@123`

### Super Admin
Email : `superadmin@mamoabio.com`
Mot de passe : `SuperAdmin@123`

**Change ces mots de passe avant toute mise en production.**

## Base SQLite

La base est créée automatiquement ici :

`data/mamoabio.db`

Tables :
- `users`
- `products`
- `inquiries`

## Photos

Depuis Administration > Produits > Ajouter, une photo peut être uploadée.
Elle sera stockée dans :

`public/uploads/`

## Sécurité

Cette version est une base fonctionnelle. Pour une vraie mise en production, il faut notamment :
- définir `JWT_SECRET` dans une variable d'environnement ;
- utiliser HTTPS ;
- changer les mots de passe de démonstration ;
- ajouter une protection CSRF/rate limiting ;
- valider strictement les fichiers uploadés ;
- éventuellement utiliser un stockage d'images externe.
