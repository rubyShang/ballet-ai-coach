# Ballet AI Coach：上线步骤

一共三步，大约 20 分钟：建数据库 → 填配置 → 发布网址。都做完以后，你和朋友在手机上打开网址，"添加到主屏幕"就能当 App 用。

## 动作

顶部可以在 **Tendu** 和 **Plié** 之间切换，每个动作都有「学一学」和「练一练」。练习记录、报告和进步趋势按动作分开统计。

- **Tendu**：devant / derrière 从侧面拍，à la seconde 从正面拍。
- **Plié**：从**正面**拍，全身和双脚都要入镜。App 会自动判断是一位还是二位、demi 还是 grand。检查项包括：膝盖对准脚尖、脚跟（demi 不离地；一位 grand 到最低时可以抬；二位 grand 不离地）、上身立直、胯放平、两边蹲得一样低、下去和起来一样慢。开始前先站直一两秒，让 App 记住地板位置和腿长。

### 已经建好数据库的话：加 plié 需要更新一次数据库

在 Supabase → **SQL Editor** 里运行 `supabase/migrate-002-plie.sql`（运行多次也没关系）。**先运行这个，再推送新版代码**，否则同步会失败。新建的数据库直接运行 `schema.sql` 就包含了，不需要这一步。

## 疼痛日记

顶部「日记」标签：每天记录疼不疼（0–5 笑脸）、哪里疼、今天做了什么（上课 / 在家练 / 排练比赛 / 休息）。App 会找出规律（最常疼的位置、排练或上课后第二天是否更容易疼），在疼得厉害或同一处反复疼时建议就医，并可以生成 8 周的报告给医生或物理治疗师看。App 不做任何诊断。

练习报告和日记页里还有「动作里的受伤风险提示」：经常硬拧外开（plié 膝盖没对准脚尖）、站立腿膝盖超伸（tendu 侧面拍时检测）、demi-plié 常蹲不深或脚跟离地。

### 已经建好数据库的话：加日记需要更新一次数据库

在 Supabase → **SQL Editor** 里运行 `supabase/migrate-003-diary.sql`（运行多次也没关系）。新建的数据库直接运行 `schema.sql` 就包含了。日记属于孩子的健康信息，同样有权限隔离，只有你自己的账号能看到。

## 文件说明

| 文件 | 作用 |
|---|---|
| `index.html` | App 本体 |
| `config.js` | 填 Supabase 的网址和 key（第 2 步） |
| `manifest.webmanifest`, `icons/` | 让手机能"安装"到主屏幕，并显示图标 |
| `sw.js` | 离线缓存。模型下载一次后，下次打开更快 |
| `supabase/schema.sql` | 数据库建表脚本（第 1 步） |
| `supabase/migrate-002-plie.sql` | 旧数据库加 plié 用的更新脚本 |
| `supabase/migrate-003-diary.sql` | 旧数据库加疼痛日记用的更新脚本 |

## 第 1 步：建 Supabase 数据库（免费）

1. 打开 https://supabase.com 注册，点 **New project**。名字随便取，地区选离你近的（比如 East US），设一个数据库密码并保存好。
2. 等项目建好（1–2 分钟），左边菜单点 **SQL Editor** → **New query**，把 `supabase/schema.sql` 的全部内容粘贴进去，点 **Run**，看到 Success 就完成了。
   这一步会建好三张表（孩子、练习、每次动作）和一个私有的截图存储桶，并设置好权限：每个账号只能看到自己的数据。
3. 让登录邮件里带验证码：左边菜单 **Authentication** → **Emails**（或 Email Templates）→ 选 **Magic Link** 模板，把内容改成：

   ```html
   <h2>Ballet AI Coach 登录验证码</h2>
   <p>你的验证码是：<strong>{{ .Token }}</strong></p>
   <p>10 分钟内有效。</p>
   ```

   保存。之所以用验证码而不用登录链接：在手机上从主屏幕打开的 App 里，点邮件链接会跳到浏览器，就登录不到 App 里了。
4. **Authentication** → **Sign In / Providers**：确认 Email 是开启的（默认就是开启）。

> Supabase 自带的发信服务每小时只能发几封邮件，你和一两个朋友用够了。登录一次以后，会一直保持登录状态。

## 第 2 步：填配置

在 Supabase 左边菜单 **Project Settings** → **API**（或 API Keys），复制：

- **Project URL**，比如 `https://abcdxyz.supabase.co`
- **anon public** key（新项目里叫 **publishable** key）

打开 `config.js`，填进去：

```js
window.BALLET_CONFIG = {
  supabaseUrl: "https://abcdxyz.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

这个 key 本来就是公开用的，放在网页里没关系，数据安全由数据库的权限规则保证。**千万不要**填 `service_role` 或 secret key。

## 第 3 步：发布成网址（免费）

手机用摄像头必须是 https 网址，所以要放到网上。两种方式任选一种：

**方式 A：GitHub Pages**
1. 在 GitHub 新建一个 **public** 仓库，比如 `ballet-ai-coach`。
2. 把整个文件夹的内容上传上去（`index.html` 要在仓库根目录）。
3. 仓库 **Settings** → **Pages** → Source 选 **Deploy from a branch**，Branch 选 `main` 和 `/ (root)`，保存。
4. 等一两分钟，就会得到网址：`https://你的用户名.github.io/ballet-ai-coach/`。

**方式 B：Netlify（不用 git，拖拽上传）**
1. 打开 https://app.netlify.com/drop 并登录。
2. 把整个文件夹拖进去，马上就会给你一个 https 网址。

最后回到 Supabase：**Authentication** → **URL Configuration**，把 **Site URL** 改成你的网址。

## 在手机上安装

- **iPhone**：用 Safari 打开网址 → 点分享按钮 → **添加到主屏幕**。
- **安卓**：用 Chrome 打开 → 菜单 → **安装应用**（或"添加到主屏幕"）。

第一次打开时，允许使用摄像头。在「账号与同步」里输入邮箱 → 收验证码 → 登录 → 添加孩子的名字，就可以开始练习了。

## 登录流程

打开网址后先进入登录页：

1. 家长输入邮箱 → 收验证码 → 输入验证码。第一次用就自动注册，不需要密码。
2. 第一次登录时填孩子的名字。
3. 进入练习页面。之后再打开，会一直保持登录状态，直接进入练习页面。

## 给朋友用

把网址发给朋友。每个家庭用自己的邮箱登录，数据互相看不到。

**只想让邀请的人用（推荐）：** 网址是公开的，任何人拿到都能注册。如果只想给认识的一两家人用：

1. `config.js` 里把 `allowSignup` 改成 `false`，提交并推送。
2. Supabase 后台 **Authentication** → **Sign In / Providers** → 关掉 **Allow new users to sign up**。
3. 要加朋友时：**Authentication** → **Users** → **Add user** → **Send invitation**，填朋友的邮箱。之后朋友打开网址、输入这个邮箱，就能收到验证码登录。
4. 你自己也要先登录过一次，或者在 Users 里先加上自己。

没被邀请的邮箱会看到"这个邮箱还没有开通"。

## 数据存在哪里

| 内容 | 位置 |
|---|---|
| 每次动作的判断结果、练习总结 | Supabase 数据库 |
| 每次动作的三张关键帧截图 | Supabase 私有存储（只有本人账号能看） |
| 腿部 12 个关键点的逐帧坐标 | Supabase 数据库（`reps.coords`） |
| 录像 | **只在手机或电脑上，不上传** |
| 全部 33 个关键点的逐帧坐标 CSV | 点「导出逐帧坐标」下载到本机 |

按免费额度（500 MB 数据库、1 GB 存储）估算：每次动作的截图约 75 KB、坐标约 20 KB，大约能存一万次动作。

## 需要知道的

- **一周没人用，Supabase 免费项目会自动暂停。** 暂停后，App 本身还能用，只是不能同步。这时登录 Supabase 后台点 **Restore** 就能恢复，数据不会丢。
- **更新 App**：改完文件重新上传后，把 `sw.js` 里的 `VERSION` 改个数字（比如 `bac-v2` → `bac-v3`），这样手机上会自动换成新版本（可能要打开两次）。
- 不填 `config.js` 也能用，只是没有账号和云同步，数据只存在当前设备上。
- 想查看数据：Supabase 后台 **Table Editor** 能直接看表，也可以在 **SQL Editor** 里写查询，比如：

  ```sql
  select d.name, s.started_at, s.total, s.good
  from sessions s join dancers d on d.id = s.dancer_id
  order by s.started_at desc;
  ```
