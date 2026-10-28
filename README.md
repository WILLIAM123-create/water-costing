# Bottled Water Production Costing

```
water-costing/
├── frontend/              -> deployed on Vercel (Root Directory = frontend)
│   ├── index.html         costing app
│   ├── login.html         sign in / create account
│   ├── account.html       change password
│   ├── admin.html         admin dashboard
│   ├── vercel.json
│   ├── css/style.css
│   └── js/  app.js  auth.js  config.js   (config.js holds the Render API address)
├── backend/               -> deployed on Render (Root Directory = backend)
│   ├── server.js
│   ├── package.json
│   └── .env.example       (copy to .env for local use; never commit .env)
├── .gitignore
└── README.md
```

## Deploy
1. Atlas: create M0 cluster, database user, allow 0.0.0.0/0, copy the connection string (add /watercosting).
2. Render: New Web Service > repo > Root Directory `backend` > Build `npm install` > Start `npm start`.
   Environment: MONGODB_URI, JWT_SECRET, FRONTEND_URL (Vercel address, no trailing slash), ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD.
3. Put the Render address in `frontend/js/config.js`.
4. Vercel: Project Settings > General > Root Directory = `frontend`.
5. `git add . && git commit -m "message" && git push` redeploys both.

## Shared data
Batches, rates and selling prices are stored in MongoDB and shared by all approved users. Only admins change rates and prices. Enter the real 10 L and 5 L rates once in the Rates panel (admin).
