const db = window.supabase.createClient(
  window.PITCHMARKET_CONFIG.url,
  window.PITCHMARKET_CONFIG.key
);

const $ = id => document.getElementById(id);
const state = { user: null, listings: [],reviews: [], imageUrl: "", busy: false };

function message(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/[^\d+]/g, "");
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  if (!/^\d{9,15}$/.test(phone)) return "";
  return phone;
}

function updateAuthUI() {
  const loggedIn = !!state.user;
  $("auth-status").textContent = loggedIn
    ? `Logged in: ${state.user.email || "Seller"}`
    : "Not logged in";
  $("auth-panel").classList.toggle("hidden", loggedIn);
  $("seller-panel").classList.toggle("hidden", !loggedIn);
  $("logout-btn").classList.toggle("hidden", !loggedIn);
}

async function refreshSession() {
  const { data, error } = await db.auth.getSession();
  if (error) {
    message("market-message", error.message, true);
    return;
  }
  state.user = data.session?.user || null;
  updateAuthUI();
}

async function authenticate(mode) {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;

  if (!email || !password) {
    message("auth-message", "Enter your email and password.", true);
    return;
  }

  $("login-btn").disabled = true;
  $("register-btn").disabled = true;
  message("auth-message", "Please wait...");

  try {
    let result;

    if (mode === "register") {
      result = await db.auth.signUp({ email, password });

      if (result.error) throw result.error;

      if (result.data.session) {
        state.user = result.data.session.user;
        updateAuthUI();
        message("auth-message", "Registration successful!");
        await loadListings();
      } else {
        message(
          "auth-message",
          "Registration received. Check your email for the confirmation link, then log in."
        );
      }
    } else {
      result = await db.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;

      state.user = result.data.user;
      updateAuthUI();
      message("auth-message", "Logged in successfully.");
      await loadListings();
    }
  } catch (error) {
    message("auth-message", error.message || "Authentication failed.", true);
  } finally {
    $("login-btn").disabled = false;
    $("register-btn").disabled = false;
  }
}

$("auth-form").addEventListener("submit", event => {
  event.preventDefault();
  authenticate("login");
});

$("register-btn").addEventListener("click", () => authenticate("register"));

$("logout-btn").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();
  if (error) {
    message("market-message", error.message, true);
    return;
  }
  state.user = null;
  clearListingForm();
  updateAuthUI();
  await loadListings();
});

function clearListingForm() {
  $("listing-form").reset();
  $("listing-id").value = "";
  state.imageUrl = "";
  $("listing-form-heading").textContent = "Post an account";
  $("save-listing-btn").textContent = "Publish listing";
  $("cancel-edit-btn").classList.add("hidden");
  message("listing-message", "");
}

$("cancel-edit-btn").addEventListener("click", clearListingForm);

async function uploadImage(file) {
  if (!file) return state.imageUrl || "";
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.user.id}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await db.storage
    .from("account-images")
    .upload(path, file, { upsert: false });

  if (error) throw error;

  const { data } = db.storage.from("account-images").getPublicUrl(path);
  return data.publicUrl;
}

$("listing-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!state.user) {
    message("listing-message", "Please log in first.", true);
    return;
  }

  const title = $("listing-title").value.trim();
  const price = Number($("listing-price").value);
  const sellerName = $("seller-name").value.trim();
  const sellerPhone = normalizePhone($("seller-phone").value);
  const strengthValue = $("team-strength").value;
  const file = $("listing-image").files[0];

  if (title.length < 3 || title.length > 100) {
    message("listing-message", "Title must be 3–100 characters.", true);
    return;
  }
  if (!Number.isSafeInteger(price) || price <= 0) {
    message("listing-message", "Enter a valid price in KSh.", true);
    return;
  }
  if (!sellerName || !sellerPhone) {
    message("listing-message", "Enter your display name and a valid phone number.", true);
    return;
  }

  const button = $("save-listing-btn");
  button.disabled = true;
  message("listing-message", "Saving listing...");

  try {
    const imageUrl = await uploadImage(file);
    const id = $("listing-id").value;

    const listing = {
      seller_id: state.user.id,
      title,
      price,
      team_strength: strengthValue ? Number(strengthValue) : null,
      platform: $("listing-platform").value,
      players: $("listing-players").value.trim(),
      description: $("listing-description").value.trim(),
      image_url: imageUrl,
      seller_name: sellerName,
      seller_phone: sellerPhone,
      status: "active"
    };

    let result;

    if (id) {
      const { seller_id, ...updates } = listing;
      result = await db.from("listings")
        .update(updates)
        .eq("id", id)
        .eq("seller_id", state.user.id)
        .select()
        .single();
    } else {
      result = await db.from("listings")
        .insert(listing)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    clearListingForm();
    message("market-message", "Listing saved successfully!");
    await loadListings();
  } catch (error) {
    message("listing-message", error.message || "Could not save listing.", true);
  } finally {
    button.disabled = false;
  }
});

function renderListings() {
  const query = $("search-input").value.trim().toLowerCase();
  const platform = $("platform-filter").value;
  const sort = $("sort-filter").value;

  let items = state.listings.filter(item => {
    const text = [
      item.title, item.players, item.seller_name,
      item.description, item.platform
    ].join(" ").toLowerCase();

    return text.includes(query) &&
      (!platform || item.platform === platform);
  });

  if (sort === "price-low") items.sort((a, b) => a.price - b.price);
  else if (sort === "price-high") items.sort((a, b) => b.price - a.price);
  else items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  $("listing-count").textContent = `${items.length} account${items.length === 1 ? "" : "s"}`;

  const grid = $("listings-grid");

  if (!items.length) {
    grid.innerHTML = '<p class="empty-state">No accounts found. Try another search or check back later.</p>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const phone = normalizePhone(item.seller_phone);
    const isOwner = state.user && state.user.id === item.seller_id;
    const image = item.image_url
      ? `<img class="listing-image" src="${escapeHTML(item.image_url)}" alt="Account screenshot" loading="lazy">`
      : '<div class="listing-placeholder">⚽<span>eFootball account</span></div>';

    const whatsapp = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent("Hi, I'm interested in your PitchMarket listing: " + item.title)}`
      : "";
    const listingReviews = state.reviews.filter(
  review => review.listing_id === item.id
);

const averageRating = listingReviews.length
  ? listingReviews.reduce((sum, review) => sum + review.rating, 0) /
    listingReviews.length
  : 0;

const ratingDisplay = listingReviews.length
  ? `<div class="review-summary">
       <span class="review-stars">★ ${averageRating.toFixed(1)} / 5</span>
       <span class="review-count">(${listingReviews.length} review${listingReviews.length === 1 ? "" : "s"})</span>
     </div>`
  : `<div class="review-summary">No ratings yet</div>`;

    return `
      <article class="listing-card">
        ${image}
        <div class="listing-body">
          <div class="listing-meta">
            <span class="platform-tag">${escapeHTML(item.platform)}</span>
            ${item.team_strength != null
              ? `<span class="strength-tag">Team ${escapeHTML(item.team_strength)}</span>` : ""}
          </div>
          ${ratingDisplay}
          <h3>${escapeHTML(item.title)}</h3>
          <p class="listing-price">KSh ${Number(item.price).toLocaleString("en-KE")}</p>
          ${item.players ? `<p><strong>Players:</strong> ${escapeHTML(item.players)}</p>` : ""}
          ${item.description ? `<p class="listing-description">${escapeHTML(item.description)}</p>` : ""}
          <p class="seller-line">Seller: ${escapeHTML(item.seller_name)}</p>
          <div class="contact-row">
            ${phone ? `<a class="btn btn-primary contact-btn" href="${whatsapp}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
            ${phone ? `<a class="btn btn-outline contact-btn" href="tel:+${phone}">Call seller</a>` : ""}
          </div>
          ${isOwner ? `
            <div class="owner-actions">
              <button class="btn btn-outline" data-edit="${escapeHTML(item.id)}">Edit</button>
              <button class="btn btn-danger" data-delete="${escapeHTML(item.id)}">Delete</button>
            </div>` : ""}
        </div>
      </article>`;
  }).join("");
}
async function loadReviews() {
  const { data, error } = await db
    .from("listing_reviews")
    .select("listing_id, seller_id, rating, review_text, created_at");

  if (error) {
    console.error("Could not load reviews:", error.message);
    state.reviews = [];
    return;
  }

  state.reviews = data || [];
}
async function loadListings() {
  $("listings-grid").innerHTML = '<p class="empty-state">Loading accounts...</p>';

  let request = db.from("listings")
    .select("*")
    .order("created_at", { ascending: false });

  const { data, error } = await request;

  if (error) {
    $("listing-count").textContent = "Unavailable";
    $("listings-grid").innerHTML = "";
    message("market-message", `Could not load listings: ${error.message}`, true);
    return;
  }

  state.listings = data || [];
await loadReviews();
renderListings();
}

$("search-input").addEventListener("input", renderListings);
$("platform-filter").addEventListener("change", renderListings);
$("sort-filter").addEventListener("change", renderListings);

$("listings-grid").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");

  if (editButton) {
    const item = state.listings.find(x => x.id === editButton.dataset.edit);
    if (!item || !state.user || item.seller_id !== state.user.id) return;

    $("listing-id").value = item.id;
    $("listing-title").value = item.title;
    $("listing-price").value = item.price;
    $("seller-name").value = item.seller_name;
    $("seller-phone").value = item.seller_phone;
    $("team-strength").value = item.team_strength ?? "";
    $("listing-platform").value = item.platform;
    $("listing-players").value = item.players || "";
    $("listing-description").value = item.description || "";
    $("listing-image").value = "";
    state.imageUrl = item.image_url || "";

    $("listing-form-heading").textContent = "Edit your account";
    $("save-listing-btn").textContent = "Save changes";
    $("cancel-edit-btn").classList.remove("hidden");
    $("seller-panel").scrollIntoView({ behavior: "smooth" });
  }

  if (deleteButton) {
    const id = deleteButton.dataset.delete;
    const item = state.listings.find(x => x.id === id);
    if (!item || !state.user || item.seller_id !== state.user.id) return;
    if (!confirm("Delete this listing? This cannot be undone.")) return;

    const { error } = await db.from("listings")
      .delete()
      .eq("id", id)
      .eq("seller_id", state.user.id);

    if (error) {
      message("market-message", error.message, true);
      return;
    }

    message("market-message", "Listing deleted.");
    await loadListings();
  }
});

db.auth.onAuthStateChange((_event, session) => {
  state.user = session?.user || null;
  updateAuthUI();
});

(async function start() {
  if (!window.PITCHMARKET_CONFIG ||
      !window.PITCHMARKET_CONFIG.url ||
      !window.PITCHMARKET_CONFIG.key) {
    message("market-message", "Supabase configuration is missing.", true);
    return;
  }

  await refreshSession();
  await loadListings();
})();
