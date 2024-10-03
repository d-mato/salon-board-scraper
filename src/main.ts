import { Actor } from "apify";
import logger from "@apify/log";
import { launchPlaywright, playwrightUtils } from "crawlee";
import { Browser, Page } from "playwright";

interface Input {
  userId: string;
  password: string;
  reserveId: string;
}

interface Output {
  reservation: {
    stylistId: string;
    date: string;
    startTime: string;
    term: string;
  };
}

async function main() {
  await Actor.init();
  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ["RESIDENTIAL"],
    countryCode: "JP",
  });
  const proxy = await proxyConfiguration?.newProxyInfo();
  const proxyUrl = proxy?.url;
  logger.info(`proxyUrl: ${proxyUrl}`);

  const input = await Actor.getInput<Input>();
  if (!input) throw new Error("Input is required");

  const browser = await launchPlaywright({
    proxyUrl,
    launchOptions: {
      // acceptDownloads: false,
      // locale: "ja-JP",
      extraHTTPHeaders: {
        // "accept-language": "ja",
        // ヘッドレスモードだと Playwright が自動的に HeadlessChrome という文字列を付与するが、これがあるとサロンボードに弾かれるため、空文字で上書きする
        "sec-ch-ua": "",
        // "sec-ch-ua-platform": '"macOS"',
      },
    },
  });

  const page = await buildPage(browser);

  await login(page, input);
  const reservation = await getReservation(input.reserveId, page);

  const output: Output = {
    reservation,
  };

  // const [staffs, coupons] = await Promise.all([
  //   page.$$("select[name='stylistId'] > option").then((options) =>
  //     Promise.all(
  //       options.map(async (option) => ({
  //         value: await option.getAttribute("value"),
  //         text: (await option.textContent())?.replace(/^(○\s|×\s)/, ""),
  //       }))
  //     )
  //   ),
  //   page.$$("select[name='netCouponId'] option").then((options) =>
  //     Promise.all(
  //       options.map(async (option) => ({
  //         value: await option.getAttribute("value"),
  //         text: await option.textContent(),
  //       }))
  //     )
  //   ),
  // ]);

  await browser.close();

  logger.info("result:", output);
  await Actor.pushData<Output>({
    reservation: output.reservation,
  });
  await Actor.exit();
}

async function buildPage(browser: Browser) {
  const page = await browser.newPage();

  await page.route("**/*", (route) => {
    const url = route.request().url();
    const domain = new URL(url).hostname;
    const blockDomains = [
      "googletagmanager.com",
      "googleadservices.com",
      "doubleclick.net",
      "google-analytics.com",
      "karte.io",
      "fout.jp",
    ];
    const resourceType = route.request().resourceType();
    const blockResourceTypes = ["image", "font", "stylesheet"];
    if (
      blockResourceTypes.includes(resourceType) ||
      blockDomains.some((blockDomain) => domain.includes(blockDomain))
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  // page.on("request", (request) => {
  //   logger.debug("request", request.headers());
  // });
  // page.on("response", (response) => {
  //   logger.debug("response:", response.url());
  // });

  return page;
}

async function login(page: Page, input: Input) {
  const url = "https://salonboard.com/login/";
  logger.info(`opening ${url}`);
  await page.goto(url, { timeout: 30000 });

  await page.title().then(async (title) => {
    if (title !== "ログイン：SALON BOARD") {
      await Actor.fail(`Failed to open login page. title: ${title}`);
    }
  });

  await page.fill("[name='userId']", input.userId);
  await page.fill("[name='password']", input.password);

  // xpath使いたい
  // const button = await page.$("//a[contains(., 'ログイン')]");
  // await button!.click();
  logger.info("submitting...");
  await Promise.all([
    page.waitForNavigation(),
    page.click(".loginBtnWrap > a"),
    //
  ]);

  await page.title().then(async (title) => {
    if (title !== "SALON BOARD : TOP") {
      await Actor.fail(`Failed to login. title: ${title}`);
    }
  });

  await playwrightUtils.saveSnapshot(page, {
    key: "login-result",
    saveScreenshot: true,
    saveHtml: true,
  });
}

async function getReservation(reserveId: string, page: Page) {
  // メニューやクーポン一覧は予約作成ページでしか取れない. どうすべきか
  // const now = new Date();
  // const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
  //   2,
  //   "0"
  // )}${String(now.getDate()).padStart(2, "0")}`;
  // const url = new URL(
  //   "https://salonboard.com/CLP/bt/reserve/ext/extReserveRegist/"
  // );
  // url.search = new URLSearchParams({
  //   date: date,
  //   time: "0000",
  //   stylistId: "0000000000",
  //   rlastupdate: `${date}000000`,
  // }).toString();

  const url = `https://salonboard.com/CLP/bt/reserve/net/instantReserveChange/?reserveId=${reserveId}`;
  logger.info(`opening ${url}`);
  await page.goto(url.toString());

  await playwrightUtils.saveSnapshot(page, {
    key: "extReserveChange",
    saveScreenshot: true,
    saveHtml: true,
  });

  const [stylistId, date, startTime, term] = await Promise.all([
    page.locator("[name='stylistId']").first().inputValue(),
    page
      .locator("[name='dispDateFrom']")
      .first()
      .inputValue()
      .then((value) => {
        // ex. 2024年10月2日（水） -> 2024-10-02
        const [year, month, day] = value.match(/\d+/g) || [];
        if (!year || !month || !day) throw new Error("Failed to parse date");
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }),
    page.locator("[name='rsvTime']").first().inputValue(),
    page.locator("[name='rsvTerm']").first().inputValue(),
  ]);

  return {
    stylistId,
    date,
    startTime,
    term,
  };
}

main();
