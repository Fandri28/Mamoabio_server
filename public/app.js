let token = localStorage.getItem("mamoabio_token") || "";
let currentUser = null;
let allProducts = [];
const $ = s => document.querySelector(s);

async function api(url, options={}) {
  const opts = {...options, headers:{...(options.headers||{}), ...(token ? {Authorization:`Bearer ${token}`} : {})}};
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && url.includes("/admin")) { logout(); }
  if (!res.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

async function loadPublicProducts() {
  allProducts = await fetch("/api/products").then(r=>r.json());
  renderPublicProducts("all");
  $("#contactProduct").innerHTML = `<option value="">Produit recherché</option>` + allProducts.map(p=>`<option>${escapeHtml(p.name)}</option>`).join("");
}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function renderPublicProducts(cat) {
  const list = allProducts.filter(p=>(cat==="all"||p.category===cat) && Number(p.available)===1);
  $("#products").innerHTML = list.map(p=>`
    <article class="product">
      <img src="${escapeHtml(p.image || 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80')}" alt="${escapeHtml(p.name)}">
      <div class="product-body"><small>${escapeHtml(p.category)}</small><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p>
      <div class="product-foot"><strong>${escapeHtml(p.price)}</strong><button onclick="openProduct(${p.id})">→</button></div></div>
    </article>`).join("");
}
window.openProduct = function(id){
  const p=allProducts.find(x=>x.id===id); if(!p)return;
  $("#modalImg").src=p.image; $("#modalCat").textContent=p.category; $("#modalTitle").textContent=p.name;
  $("#modalDesc").textContent=p.description; $("#modalPrice").textContent=p.price;
  $("#modalOrder").onclick=()=>{$("#modal").classList.remove("show");$("#contactProduct").value=p.name};
  $("#modal").classList.add("show");
};
$("#closeModal").onclick=()=>$("#modal").classList.remove("show");
document.querySelector(".backdrop").onclick=()=>$("#modal").classList.remove("show");

// AJOUT : "Demander ce produit" -> ferme le pop-up et revient à la liste des produits
$("#modalOrder").addEventListener("click", e => {
  e.preventDefault();                                                        // pas de saut vers #contact
  $("#modal").classList.remove("show");                                      // ferme le pop-up
  document.querySelector("#produits").scrollIntoView({behavior:"smooth"});  // retour à la liste
});

document.querySelectorAll("#filters button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("#filters button").forEach(x=>x.classList.remove("active")); b.classList.add("active"); renderPublicProducts(b.dataset.cat);
});
$("#menuBtn").onclick=()=>$("#mobileNav").classList.toggle("open");

$("#contactForm").onsubmit=async e=>{
  e.preventDefault(); const form=new FormData(e.target); const data=Object.fromEntries(form);
  try{
    const r=await fetch("/api/inquiries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||"Erreur lors de l'envoi.");}
    e.target.reset();
    $("#contactProduct").value="";   // retour à « Produit recherché »
    $("#contactMsg").textContent="✓ Votre demande a bien été enregistrée.";
    setTimeout(()=>{$("#contactMsg").textContent=""},4000);
  }catch(err){$("#contactMsg").textContent=err.message}
};

// ===== Popup Administration =====
function openAdmin(){
  $("#mobileNav").classList.remove("open");
  $("#adminModal").classList.add("show");
  document.body.classList.add("admin-open");
  if(currentUser){ showDashboard().catch(()=>{}); }
  else { $("#adminModal").classList.add("is-login"); setTimeout(()=>$("#identifier").focus(),50); }
}
function closeAdmin(){
  $("#adminModal").classList.remove("show");
  document.body.classList.remove("admin-open");
}
document.querySelectorAll("[data-open-admin]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();openAdmin()}));
document.querySelectorAll("[data-close-admin]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();closeAdmin()}));
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape") return;
  if($("#productFormModal").classList.contains("show")) $("#productFormModal").classList.remove("show");
  else if($("#userModal").classList.contains("show")) $("#userModal").classList.remove("show");
  else if($("#adminModal").classList.contains("show")) closeAdmin();
});

async function login(){
  try{
    const data=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({identifier:$("#identifier").value,password:$("#password").value})}).then(async r=>{
        const d=await r.json(); if(!r.ok)throw new Error(d.error); return d;
      });
    token=data.token; currentUser=data.user; localStorage.setItem("mamoabio_token",token);
    showDashboard();
  }catch(e){$("#loginMsg").textContent=e.message}
}
$("#loginForm").onsubmit=e=>{e.preventDefault();login()};
$("#logout").onclick=()=>{logout();closeAdmin()};
function logout(){
  token="";currentUser=null;localStorage.removeItem("mamoabio_token");
  $("#dashboardView").hidden=true;$("#loginView").style.display="grid";
  $("#adminModal").classList.add("is-login");
  $("#loginForm").reset();$("#loginMsg").textContent="";
}

async function showDashboard(){
  if(!currentUser) return;
  const isSuper=currentUser.role==="super_admin";
  $("#loginView").style.display="none"; $("#dashboardView").hidden=false; $("#adminModal").classList.remove("is-login");
  $("#currentUser").textContent=currentUser.username + (isSuper ? " · Super Admin":" · Admin");
  document.querySelectorAll(".super-only").forEach(x=>x.style.display=isSuper?"inline-block":"none");
  // repartir sur l'onglet Produits et vider la liste des utilisateurs pour un simple admin
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(x=>x.hidden=true);
  document.querySelector('[data-tab="productsTab"]').classList.add("active"); $("#productsTab").hidden=false;
  if(!isSuper) $("#adminUsers").innerHTML="";
  await refreshDashboard(); await loadAdminProducts(); await loadInquiries();
  if(isSuper) await loadUsers();
}
async function refreshDashboard(){
  const s=await api("/api/admin/stats");
  ["products","available","stockOut","inquiries"].forEach(k=>{
    const el=$("#s"+k[0].toUpperCase()+k.slice(1));
    if(el) el.textContent=s[k];
  });
}

async function loadAdminProducts(){
  const ps=await api("/api/admin/products");
  $("#adminProducts").innerHTML=ps.map(p=>`<tr><td><img class="thumb" src="${escapeHtml(p.image)}"></td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td><td>${p.stock} ${escapeHtml(p.unit)}</td><td><span class="status ${p.available?"ok":"off"}">${p.available?"Disponible":"Rupture"}</span></td><td><button class="action" onclick='editProduct(${JSON.stringify(p).replace(/'/g,"&#39;")})'>Modifier</button><button class="action danger" onclick="deleteProduct(${p.id})">Supprimer</button></td></tr>`).join("");
}
window.deleteProduct=async id=>{if(!confirm("Supprimer ce produit ?"))return;await api("/api/admin/products/"+id,{method:"DELETE"});await refreshDashboard();await loadAdminProducts();await loadPublicProducts()};
window.editProduct=p=>{openProductForm(p)};

function openProductForm(p=null){
  $("#productFormModal").classList.add("show"); $("#productFormTitle").textContent=p?"Modifier le produit":"Ajouter un produit";
  const f=$("#productForm"); f.reset(); f.elements.id.value=p?.id||""; f.elements.name.value=p?.name||""; f.elements.category.value=p?.category||"cacao";
  f.elements.description.value=p?.description||"";f.elements.origin.value=p?.origin||"Madagascar";f.elements.price.value=p?.price||"Prix sur demande";
  f.elements.stock.value=p?.stock??0;f.elements.unit.value=p?.unit||"kg";f.elements.available.checked=!!(p?.available??1);f.elements.featured.checked=!!p?.featured;
}
$("#newProduct").onclick=()=>openProductForm();
document.querySelector("[data-close-form]").onclick=()=>$("#productFormModal").classList.remove("show");
$("#productForm").onsubmit=async e=>{
  e.preventDefault(); const f=e.target, id=f.elements.id.value; const data=new FormData(f);
  data.set("available",f.elements.available.checked?"1":"0");data.set("featured",f.elements.featured.checked?"1":"0");
  try{await api(id?"/api/admin/products/"+id:"/api/admin/products",{method:id?"PUT":"POST",body:data});
    $("#productFormModal").classList.remove("show");await refreshDashboard();await loadAdminProducts();await loadPublicProducts();
  }catch(err){$("#productMsg").textContent=err.message}
};

async function loadInquiries(){
 const items=await api("/api/admin/inquiries");
 const isSuper=currentUser && currentUser.role==="super_admin";
 const labels={new:"Nouvelle",confirmed:"Confirmée",not_confirmed:"Non confirmée"};
 const svg=p=>`<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
 const I={ok:svg('<path d="M20 6L9 17l-5-5"/>'),no:svg('<path d="M18 6L6 18M6 6l12 12"/>'),del:svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>')};
 $("#inquiries").innerHTML=items.map(x=>`
  <div class="inquiry st-${escapeHtml(x.status)}">
   <div class="iq-head">
    <div class="iq-who"><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.email)}</small></div>
    <span class="status ${x.status==="confirmed"?"ok":(x.status==="not_confirmed"?"off":"neutral")}">${labels[x.status]||escapeHtml(x.status)}</span>
   </div>
   <p>${x.product?`<strong>${escapeHtml(x.product)}</strong><br>`:""}${escapeHtml(x.message)}</p>
   <div class="iq-actions">
    <button type="button" class="iq-btn iq-ok ${x.status==="confirmed"?"active":""}" data-act="confirmed" data-id="${x.id}" title="Confirmer" aria-label="Confirmer">${I.ok}<span>Confirmer</span></button>
    <button type="button" class="iq-btn iq-no ${x.status==="not_confirmed"?"active":""}" data-act="not_confirmed" data-id="${x.id}" title="Non confirmer" aria-label="Non confirmer">${I.no}<span>Non confirmer</span></button>
    ${isSuper?`<button type="button" class="iq-btn iq-del" data-act="delete" data-id="${x.id}" title="Supprimer" aria-label="Supprimer">${I.del}<span>Supprimer</span></button>`:""}
   </div>
  </div>`).join("")||"<p>Aucune demande.</p>";
}
$("#inquiries").addEventListener("click", async e=>{
 const btn=e.target.closest("button[data-act]"); if(!btn) return;
 const id=btn.dataset.id, act=btn.dataset.act;
 try{
  if(act==="delete"){
   if(!confirm("Supprimer cette demande ?")) return;
   await api("/api/admin/inquiries/"+id,{method:"DELETE"});
  } else {
   await api("/api/admin/inquiries/"+id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:act})});
  }
  await loadInquiries();
  try{await refreshDashboard()}catch{}
 }catch(err){alert(err.message)}
});
async function loadUsers(){
 const users=await api("/api/admin/users");
 $("#adminUsers").innerHTML=users.map(u=>`<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td><td>${u.role}</td><td><button class="action danger" onclick="deleteUser(${u.id})">Supprimer</button></td></tr>`).join("");
}
window.deleteUser=async id=>{if(!confirm("Supprimer cet utilisateur ?"))return;try{await api("/api/admin/users/"+id,{method:"DELETE"});loadUsers()}catch(e){alert(e.message)}};
$("#newUser").onclick=()=>$("#userModal").classList.add("show");
document.querySelector("[data-close-user]").onclick=()=>$("#userModal").classList.remove("show");
$("#userForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});$("#userModal").classList.remove("show");e.target.reset();loadUsers()}catch(err){$("#userMsg").textContent=err.message}};
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".tab-content").forEach(x=>x.hidden=true);t.classList.add("active");$("#"+t.dataset.tab).hidden=false});

// AJOUT : rafraîchir la liste et le compteur quand on ouvre l'onglet "Demandes"
document.querySelector('[data-tab="inquiriesTab"]').addEventListener("click",()=>{
  loadInquiries().catch(()=>{}); refreshDashboard().catch(()=>{});
});

(async()=>{
  await loadPublicProducts();
  if(token){try{currentUser=(await api("/api/auth/me")).user;showDashboard()}catch{logout()}}
})();