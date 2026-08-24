import { expect, test } from "@playwright/test";

test.describe("acceso al panel", () => {
  test("un visitante anónimo termina en el login, con la ruta guardada", async ({ page }) => {
    await page.goto("/admin/inventory");

    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Finventory$/);
    await expect(page.getByRole("heading", { name: "Entrar al panel" })).toBeVisible();
  });

  test("el login pide un correo válido antes de enviar nada", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar enlace de acceso" })).toBeEnabled();
  });
});

test.describe("tienda pública", () => {
  test("la home abre en español y cambia a inglés", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Cartas y cajas de colección",
    );

    await page.getByRole("button", { name: "EN" }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Collectible cards");
  });
});
