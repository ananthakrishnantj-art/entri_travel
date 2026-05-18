const form = document.querySelector("#tripForm");
const statusBox = document.querySelector("#status");
const planOutput = document.querySelector("#planOutput");
const copyButton = document.querySelector("#copyButton");
const themeToggle = document.querySelector("#themeToggle");
const buttonText = document.querySelector("#buttonText");
const spinner = document.querySelector("#spinner");
const modelLabel = document.querySelector("#modelLabel");

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.documentElement.classList.add("dark");
  themeToggle.innerHTML = "&#9790;";
}

themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  themeToggle.innerHTML = isDark ? "&#9790;" : "&#9788;";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  setLoading(true);
  setStatus("Building your itinerary...", "");
  planOutput.hidden = true;
  copyButton.disabled = true;

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to create a plan.");
    }

    renderMarkdown(data.plan);
    modelLabel.textContent = `Generated with ${data.model}`;
    setStatus("Itinerary ready.", "success", true);
    copyButton.disabled = false;
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  const text = planOutput.dataset.rawPlan || "";
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copyButton.textContent = "Copied";
  setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1400);
});

function setLoading(isLoading) {
  form.querySelector("button[type='submit']").disabled = isLoading;
  buttonText.textContent = isLoading ? "Planning..." : "Plan My Trip ->";
  spinner.hidden = !isLoading;
}

function setStatus(message, type, hide = false) {
  statusBox.textContent = message;
  statusBox.className = `status ${type || ""}`.trim();
  statusBox.hidden = hide;
}

function renderMarkdown(markdown) {
  planOutput.dataset.rawPlan = markdown;
  planOutput.innerHTML = markdownToHtml(markdown);
  planOutput.hidden = false;
}

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split(/\r?\n/);
  let html = "";
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h3>${formatInline(heading[1])}</h3>`;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${formatInline(bullet[1])}</li>`;
      continue;
    }

    if (inList) {
      html += "</ul>";
      inList = false;
    }
    html += `<p>${formatInline(line)}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function formatInline(value) {
  return value.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
