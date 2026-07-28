export default {
  async rewrites() {
    return [{ source: "/api/billing/:path*", destination: "http://payment.test/:path*" }];
  },
};
