import {ProfileManager} from "@/components/ProfileManager";
// 认证统一由请求代理处理，配置页外壳不读取专栏或服务密钥。
export default function ProfilesPage() { return <ProfileManager />; }
