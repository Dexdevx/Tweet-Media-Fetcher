import { Router, type IRouter } from "express";
import healthRouter from "./health";
import extractRouter from "./extract";
import proxyMediaRouter from "./proxy-media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(extractRouter);
router.use(proxyMediaRouter);

export default router;
