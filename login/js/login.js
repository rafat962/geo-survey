/* =========================================================================
 * LOGIN PAGE LOGIC (AUTH_USERS Worker Session Authentication)
 * ========================================================================= */

(function () {
  const REMEMBER_KEY = "fieldAppRememberUser";
  const IS_LOCAL_FILE = location.protocol === "file:";

  const form = document.getElementById("loginForm");
  const userInput = document.getElementById("username");
  const passInput = document.getElementById("password");
  const rememberBox = document.getElementById("rememberMe");
  const togglePassBtn = document.getElementById("togglePassword");
  const errorBox = document.getElementById("loginError");
  const submitBtn = document.getElementById("btnLogin");
  const spinner = document.getElementById("loginSpinner");
  const btnLabel = document.getElementById("loginBtnLabel");

  // Restore remembered username if saved
  try {
    const savedUser = localStorage.getItem(REMEMBER_KEY);
    if (savedUser) {
      userInput.value = savedUser;
      rememberBox.checked = true;
    }
  } catch (err) {}

  // Redirect automatically if session is already valid
  async function checkExistingSession() {
    if (IS_LOCAL_FILE) return;
    try {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated) {
          window.location.replace("/");
        }
      }
    } catch (err) {}
  }

  checkExistingSession();

  // Password visibility toggle
  togglePassBtn.addEventListener("click", () => {
    const isPassword = passInput.type === "password";
    passInput.type = isPassword ? "text" : "password";
    togglePassBtn.setAttribute("aria-pressed", String(isPassword));
    togglePassBtn.setAttribute(
      "aria-label",
      isPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"
    );
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add("visible");
    form.classList.remove("shake");
    void form.offsetWidth;
    form.classList.add("shake");
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.remove("visible");
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    spinner.classList.toggle("visible", isLoading);
    btnLabel.textContent = isLoading ? "جاري التحقق..." : "تسجيل الدخول";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const username = userInput.value.trim();
    const password = passInput.value;
    const remember = rememberBox.checked;

    if (!username || !password) {
      showError("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }

    if (IS_LOCAL_FILE) {
      window.location.href = "../index.html";
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ username, password, remember })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        try {
          if (remember) {
            localStorage.setItem(REMEMBER_KEY, username);
          } else {
            localStorage.removeItem(REMEMBER_KEY);
          }
        } catch (err) {}

        window.location.replace("/");
        return;
      }

      showError(data.message || "اسم المستخدم أو كلمة المرور غير صحيحة");
      passInput.select();
    } catch (err) {
      showError("تعذّر الاتصال بالخادم، يُرجى المحاولة لاحقاً");
    } finally {
      setLoading(false);
    }
  });
})();
